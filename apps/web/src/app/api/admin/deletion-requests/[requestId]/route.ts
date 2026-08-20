import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAudit, adminFail, adminOk, requireAdminRequest } from "@/server/admin";
import { ApiError, jsonBody } from "@/server/api";
import { db } from "@/server/db";

type Context = { params: Promise<{ requestId: string }> };

const transitions: Record<string, string[]> = {
  pending: ["approved", "rejected"],
  approved: ["completed", "rejected"],
};

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { requestId } = await context.params;
    z.uuid().parse(requestId);
    const input = z
      .object({
        status: z.enum(["approved", "rejected", "completed"]),
        note: z.string().trim().max(1_000).optional(),
      })
      .strict()
      .parse(await jsonBody(request));
    const operation = db.transaction(() => {
      const current = db
        .prepare(
          `SELECT r.id, r.user_id AS userId, r.status, u.nickname
           FROM account_deletion_requests r JOIN users u ON u.id = r.user_id
           WHERE r.id = ?`,
        )
        .get(requestId) as { id: string; userId: string; status: string; nickname: string } | undefined;
      if (!current) throw new ApiError(404, "注销申请不存在", "DELETION_REQUEST_NOT_FOUND");
      if (!transitions[current.status]?.includes(input.status)) {
        throw new ApiError(409, `注销申请无法从 ${current.status} 变更为 ${input.status}`, "INVALID_DELETION_TRANSITION");
      }

      let revokedShares = 0;
      let revokedInvites = 0;
      let autoDisabledTeams = 0;
      if (input.status === "completed") {
        const blockingOwnedTeams = (db
          .prepare(
            `SELECT COUNT(*) AS value FROM teams t
             WHERE t.owner_id = ? AND t.status = 'active'
             AND EXISTS (
               SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id
               WHERE tm.team_id = t.id AND tm.user_id <> t.owner_id
               AND u.status = 'active'
               AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
             )`,
          )
          .get(current.userId) as { value: number }).value;
        if (blockingOwnedTeams > 0) {
          throw new ApiError(
            409,
            `该用户仍拥有 ${blockingOwnedTeams} 个有其他成员的正常团队，请先转移所有权`,
            "TEAM_OWNERSHIP",
          );
        }
        autoDisabledTeams = db
          .prepare(
            `UPDATE teams SET status = 'disabled',
              disabled_at = COALESCE(disabled_at, CURRENT_TIMESTAMP),
              disabled_reason = '所有者账号注销', updated_at = CURRENT_TIMESTAMP
             WHERE owner_id = ? AND status = 'active'`,
          )
          .run(current.userId).changes;
        revokedShares = db
          .prepare(
            `UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP
             WHERE revoked_at IS NULL AND (
               created_by = ? OR item_id IN (
                 SELECT v.id FROM vault_items v JOIN teams t ON t.id = v.team_id
                 WHERE t.owner_id = ? AND t.status = 'disabled'
               )
             )`,
          )
          .run(current.userId, current.userId).changes;
        revokedInvites = db
          .prepare(
            `UPDATE team_invites SET revoked_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP
             WHERE revoked_at IS NULL AND used_at IS NULL
             AND (created_by = ? OR team_id IN (
               SELECT id FROM teams WHERE owner_id = ? AND status = 'disabled'
             ))`,
          )
          .run(current.userId, current.userId).changes;
        const deletedOpenId = `deleted_${randomBytes(24).toString("hex")}`;
        db.prepare(
          `UPDATE users SET open_id = ?, union_id = NULL, nickname = '已注销用户',
            avatar_url = NULL, avatar_blob = NULL, avatar_mime = NULL,
            avatar_version = avatar_version + 1,
            status = 'disabled', disabled_at = CURRENT_TIMESTAMP,
            disabled_reason = '账号注销完成', session_version = session_version + 1
           WHERE id = ?`,
        ).run(deletedOpenId, current.userId);
      }
      db.prepare(
        `UPDATE account_deletion_requests SET status = ?, processor_note = ?,
          processed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(input.status, input.note || null, requestId);
      adminAudit(request, session, {
        action: input.status === "completed"
          ? "ADMIN_ACCOUNT_DELETION_COMPLETE"
          : input.status === "approved"
            ? "ADMIN_ACCOUNT_DELETION_APPROVE"
            : "ADMIN_ACCOUNT_DELETION_REJECT",
        targetType: "account_deletion_request",
        targetId: requestId,
        detail: {
          userId: current.userId,
          previousStatus: current.status,
          status: input.status,
          noteProvided: Boolean(input.note),
          revokedShares,
          revokedInvites,
          autoDisabledTeams,
        },
      });
      return { revokedShares, revokedInvites, autoDisabledTeams };
    });
    const result = operation.immediate();
    const deletionRequest = db
      .prepare(
        `SELECT id, user_id AS userId, status, requested_at AS requestedAt,
          processed_at AS processedAt, request_note AS requestNote,
          processor_note AS processorNote
         FROM account_deletion_requests WHERE id = ?`,
      )
      .get(requestId);
    return adminOk({ deletionRequest, ...result });
  } catch (error) {
    return adminFail(error);
  }
}
