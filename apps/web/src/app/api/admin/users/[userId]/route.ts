import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAudit, adminFail, adminOk, parseAuditDetail, requireAdminRequest } from "@/server/admin";
import { ApiError, jsonBody } from "@/server/api";
import { db } from "@/server/db";
import { avatarPayloadSchema, MAX_AVATAR_JSON_BYTES, sanitizeAvatar } from '@/server/avatar';
import { renameDefaultWallet } from '@/server/profile';

type Context = { params: Promise<{ userId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    await requireAdminRequest(request);
    const { userId } = await context.params;
    z.uuid().parse(userId);
    const user = db
      .prepare(
        `SELECT u.id, u.nickname, u.avatar_url AS avatarUrl, u.status,
          u.disabled_at AS disabledAt, u.disabled_reason AS disabledReason,
          u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
          (SELECT COUNT(*) FROM team_members tm WHERE tm.user_id = u.id) AS teamCount,
          (SELECT COUNT(*) FROM vault_items v WHERE v.created_by = u.id) AS itemCount
         FROM users u WHERE u.id = ?`,
      )
      .get(userId);
    if (!user) throw new ApiError(404, "用户不存在", "USER_NOT_FOUND");
    const teams = db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.status, tm.role,
          tm.expires_at AS expiresAt, tm.joined_at AS joinedAt
         FROM team_members tm JOIN teams t ON t.id = tm.team_id
         WHERE tm.user_id = ? ORDER BY datetime(t.updated_at) DESC`,
      )
      .all(userId);
    const auditRows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
          a.detail, a.created_at AS createdAt, t.id AS teamId, t.name AS teamName
         FROM audit_logs a LEFT JOIN teams t ON t.id = a.team_id
         WHERE a.actor_id = ? OR (a.target_type = 'user' AND a.target_id = ?)
         ORDER BY datetime(a.created_at) DESC LIMIT 20`,
      )
      .all(userId, userId) as Array<Record<string, unknown> & { detail: string }>;
    const recentAudit = auditRows.map(({ detail, ...row }) => ({ ...row, detail: parseAuditDetail(detail) }));
    const deletionRequests = db
      .prepare(
        `SELECT id, status, requested_at AS requestedAt,
          processed_at AS processedAt,
          request_note AS requestNote,
          processor_note AS processorNote
         FROM account_deletion_requests WHERE user_id = ?
         ORDER BY datetime(requested_at) DESC LIMIT 20`,
      )
      .all(userId);
    return adminOk({ user, teams, recentAudit, deletionRequests });
  } catch (error) {
    return adminFail(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { userId } = await context.params;
    z.uuid().parse(userId);
    const input = z
      .object({
        status: z.enum(["active", "disabled"]).optional(),
        nickname: z.string().trim().min(1).max(64).optional(),
        avatar: avatarPayloadSchema.optional(),
        reason: z.string().trim().max(300).optional(),
      })
      .strict()
      .refine((value) => value.status !== undefined || value.nickname !== undefined || value.avatar !== undefined, '至少需要修改一项信息')
      .parse(await jsonBody(request, MAX_AVATAR_JSON_BYTES));
    const avatar = input.avatar ? await sanitizeAvatar(input.avatar.data, input.avatar.mimeType) : null;
    const operation = db.transaction(() => {
      const current = db
        .prepare("SELECT id, nickname, status FROM users WHERE id = ?")
        .get(userId) as { id: string; nickname: string; status: "active" | "disabled" } | undefined;
      if (!current) throw new ApiError(404, "用户不存在", "USER_NOT_FOUND");
      if (input.status === "active" || input.nickname !== undefined || avatar) {
        const completedDeletion = db
          .prepare(
            "SELECT 1 FROM account_deletion_requests WHERE user_id = ? AND status = 'completed' LIMIT 1",
          )
          .get(userId);
        if (completedDeletion) {
          throw new ApiError(409, "已完成注销的账号不能修改或恢复", "ACCOUNT_DELETED");
        }
      }
      if (input.nickname !== undefined) {
        db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(input.nickname, userId);
        renameDefaultWallet(userId, current.nickname, input.nickname);
      }
      if (avatar) {
        db.prepare(`UPDATE users SET avatar_blob = ?, avatar_mime = ?, avatar_version = avatar_version + 1,
          avatar_url = '/api/v1/avatars/' || id || '?v=' || (avatar_version + 1) WHERE id = ?`).run(avatar.bytes, avatar.mime, userId);
      }
      if (input.nickname !== undefined || avatar) {
        adminAudit(request, session, {
          action: 'ADMIN_USER_PROFILE_UPDATE', targetType: 'user', targetId: userId,
          detail: { fields: [...(input.nickname !== undefined ? ['nickname'] : []), ...(avatar ? ['avatar'] : [])] },
        });
      }
      if (input.status === undefined) return { revokedShares: 0, revokedInvites: 0, sessionsRevoked: false };
      const reason = input.status === "disabled" ? input.reason || "管理员停用" : null;
      const revokedShares = input.status === "disabled"
        ? db.prepare(
            "UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP WHERE created_by = ? AND revoked_at IS NULL",
          ).run(userId).changes
        : 0;
      const revokedInvites = input.status === "disabled"
        ? db.prepare(
            `UPDATE team_invites SET revoked_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP
             WHERE created_by = ? AND revoked_at IS NULL AND used_at IS NULL`,
          ).run(userId).changes
        : 0;
      const sessionVersionIncrement = input.status === current.status ? 0 : 1;
      db.prepare(
        `UPDATE users SET status = ?,
          disabled_at = CASE WHEN ? = 'disabled' THEN COALESCE(disabled_at, CURRENT_TIMESTAMP) ELSE NULL END,
          disabled_reason = ?, session_version = session_version + ? WHERE id = ?`,
      ).run(input.status, input.status, reason, sessionVersionIncrement, userId);
      adminAudit(request, session, {
        action: "ADMIN_USER_STATUS_UPDATE",
        targetType: "user",
        targetId: userId,
        detail: {
          previousStatus: current.status,
          status: input.status,
          reason,
          revokedShares,
          revokedInvites,
          sessionsRevoked: sessionVersionIncrement === 1,
        },
      });
      return { revokedShares, revokedInvites, sessionsRevoked: sessionVersionIncrement === 1 };
    });
    const result = operation.immediate();
    const user = db
      .prepare(
        `SELECT id, nickname, avatar_url AS avatarUrl, status,
          disabled_at AS disabledAt, disabled_reason AS disabledReason,
          created_at AS createdAt, last_login_at AS lastLoginAt
         FROM users WHERE id = ?`,
      )
      .get(userId);
    return adminOk({ user, ...result });
  } catch (error) {
    return adminFail(error);
  }
}
