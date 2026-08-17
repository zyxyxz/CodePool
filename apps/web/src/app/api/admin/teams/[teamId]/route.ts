import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAudit, adminFail, adminOk, parseAuditDetail, requireAdminRequest } from "@/server/admin";
import { ApiError, jsonBody } from "@/server/api";
import { db } from "@/server/db";

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdminRequest(request);
    const { teamId } = await context.params;
    z.uuid().parse(teamId);
    const team = db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.status,
          t.disabled_at AS disabledAt, t.disabled_reason AS disabledReason,
          t.created_at AS createdAt, t.updated_at AS updatedAt,
          u.id AS ownerId, u.nickname AS ownerName, u.avatar_url AS ownerAvatarUrl,
          CASE WHEN u.status = 'active' AND EXISTS (
            SELECT 1 FROM team_members owner_tm
            WHERE owner_tm.team_id = t.id AND owner_tm.user_id = t.owner_id
            AND (owner_tm.expires_at IS NULL OR datetime(owner_tm.expires_at) > CURRENT_TIMESTAMP)
          ) THEN 1 ELSE 0 END AS canRestore,
          (SELECT COUNT(*) FROM team_members candidate_tm JOIN users candidate_u
           ON candidate_u.id = candidate_tm.user_id
           WHERE candidate_tm.team_id = t.id AND candidate_u.status = 'active'
           AND (candidate_tm.expires_at IS NULL OR datetime(candidate_tm.expires_at) > CURRENT_TIMESTAMP)) AS eligibleOwnerCount,
          (SELECT COUNT(*) FROM team_members tm JOIN users x ON x.id = tm.user_id
           WHERE tm.team_id = t.id AND x.status = 'active'
           AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)) AS memberCount,
          (SELECT COUNT(*) FROM vault_items v WHERE v.team_id = t.id) AS itemCount
         FROM teams t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`,
      )
      .get(teamId);
    if (!team) throw new ApiError(404, "团队不存在", "TEAM_NOT_FOUND");

    const members = db
      .prepare(
        `SELECT u.id, u.id AS userId, u.nickname, u.avatar_url AS avatarUrl, u.status,
          tm.role, tm.expires_at AS expiresAt, tm.joined_at AS joinedAt
          , CASE WHEN u.status = 'active'
            AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
            THEN 1 ELSE 0 END AS eligibleOwner
         FROM team_members tm JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ?
         ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
          datetime(tm.joined_at)`,
      )
      .all(teamId);
    const contentByKind = db
      .prepare("SELECT kind, status, COUNT(*) AS count FROM vault_items WHERE team_id = ? GROUP BY kind, status")
      .all(teamId);
    const auditRows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
          a.detail, a.created_at AS createdAt, u.id AS actorId, u.nickname AS actorName
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.team_id = ? ORDER BY datetime(a.created_at) DESC LIMIT 20`,
      )
      .all(teamId) as Array<Record<string, unknown> & { detail: string }>;
    const recentAudit = auditRows.map(({ detail, ...row }) => ({ ...row, detail: parseAuditDetail(detail) }));
    return adminOk({ team, members, contentByKind, recentAudit });
  } catch (error) {
    return adminFail(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { teamId } = await context.params;
    z.uuid().parse(teamId);
    const input = z
      .object({
        name: z.string().trim().min(2).max(48).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        ownerId: z.uuid().optional(),
        reason: z.string().trim().max(300).optional(),
      })
      .strict()
      .refine(
        (value) => value.name !== undefined || value.status !== undefined || value.ownerId !== undefined,
        "至少需要修改一个字段",
      )
      .parse(await jsonBody(request));
    const operation = db.transaction(() => {
      const current = db
      .prepare("SELECT id, name, status, owner_id AS ownerId FROM teams WHERE id = ?")
      .get(teamId) as { id: string; name: string; status: "active" | "disabled"; ownerId: string } | undefined;
      if (!current) throw new ApiError(404, "团队不存在", "TEAM_NOT_FOUND");

      const nextOwnerId = input.ownerId ?? current.ownerId;
      const nextName = input.name ?? current.name;
      const nextStatus = input.status ?? current.status;
      if (nextOwnerId !== current.ownerId) {
        const nextOwner = db
          .prepare(
            `SELECT u.id FROM users u
             JOIN team_members tm ON tm.user_id = u.id AND tm.team_id = ?
             WHERE u.id = ? AND u.status = 'active'
             AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)`,
          )
          .get(teamId, nextOwnerId);
        if (!nextOwner) {
          throw new ApiError(422, "新所有者必须是团队内未过期的正常用户", "INVALID_TEAM_OWNER");
        }
      }
      if (nextStatus === "active") {
        const activeOwner = db
          .prepare(
            `SELECT u.id FROM users u
             JOIN team_members tm ON tm.user_id = u.id AND tm.team_id = ?
             WHERE u.id = ? AND u.status = 'active'
             AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)`,
          )
          .get(teamId, nextOwnerId);
        if (!activeOwner) {
          throw new ApiError(422, "启用团队前必须指定团队内未过期的正常用户作为所有者", "INVALID_TEAM_OWNER");
        }
      }

      const reason = nextStatus === "disabled" ? input.reason || "管理员停用" : null;
      const revokedShares = nextStatus === "disabled"
        ? db.prepare(
            `UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP
             WHERE revoked_at IS NULL AND item_id IN
               (SELECT id FROM vault_items WHERE team_id = ?)`,
          ).run(teamId).changes
        : 0;
      const revokedInvites = nextStatus === "disabled"
        ? db.prepare(
            `UPDATE team_invites SET revoked_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP
             WHERE team_id = ? AND revoked_at IS NULL AND used_at IS NULL`,
          ).run(teamId).changes
        : 0;
      if (nextOwnerId !== current.ownerId) {
        db.prepare(
          "UPDATE team_members SET role = 'admin' WHERE team_id = ? AND role = 'owner' AND user_id <> ?",
        ).run(teamId, nextOwnerId);
        db.prepare(
          "UPDATE team_members SET role = 'owner', expires_at = NULL WHERE team_id = ? AND user_id = ?",
        ).run(teamId, nextOwnerId);
      }
      db.prepare(
        `UPDATE teams SET name = ?, status = ?, owner_id = ?,
          disabled_at = CASE WHEN ? = 'disabled' THEN COALESCE(disabled_at, CURRENT_TIMESTAMP) ELSE NULL END,
          disabled_reason = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(nextName, nextStatus, nextOwnerId, nextStatus, reason, teamId);
      adminAudit(request, session, {
        teamId,
        action: nextOwnerId !== current.ownerId
          ? "ADMIN_TEAM_OWNER_TRANSFER"
          : input.status
            ? "ADMIN_TEAM_STATUS_UPDATE"
            : "ADMIN_TEAM_UPDATE",
        targetType: "team",
        targetId: teamId,
        detail: {
          previousStatus: current.status,
          status: nextStatus,
          nameChanged: nextName !== current.name,
          previousOwnerId: current.ownerId,
          ownerId: nextOwnerId,
          reason,
          revokedShares,
          revokedInvites,
        },
      });
      return { revokedShares, revokedInvites };
    });
    const result = operation.immediate();
    const team = db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.status, t.owner_id AS ownerId,
          u.nickname AS ownerName, t.disabled_at AS disabledAt,
          t.disabled_reason AS disabledReason, t.created_at AS createdAt,
          t.updated_at AS updatedAt
         FROM teams t JOIN users u ON u.id = t.owner_id WHERE t.id = ?`,
      )
      .get(teamId);
    return adminOk({ team, ...result });
  } catch (error) {
    return adminFail(error);
  }
}
