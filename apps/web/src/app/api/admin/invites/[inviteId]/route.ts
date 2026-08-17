import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAudit, adminFail, adminOk, requireAdminRequest } from "@/server/admin";
import { ApiError } from "@/server/api";
import { db } from "@/server/db";

type Context = { params: Promise<{ inviteId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { inviteId } = await context.params;
    z.uuid().parse(inviteId);
    type InviteRow = { id: string; teamId: string; role: string; usedAt: string | null; revokedAt: string | null; expiresAt: string };
    const operation = db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE team_invites SET revoked_at = CURRENT_TIMESTAMP,
            expires_at = CURRENT_TIMESTAMP
           WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL
           RETURNING id, team_id AS teamId, role, used_at AS usedAt,
             revoked_at AS revokedAt, expires_at AS expiresAt`,
        )
        .get(inviteId) as InviteRow | undefined;
      const current = updated || db
        .prepare(
          `SELECT id, team_id AS teamId, role, used_at AS usedAt,
            revoked_at AS revokedAt, expires_at AS expiresAt
           FROM team_invites WHERE id = ?`,
        )
        .get(inviteId) as InviteRow | undefined;
      if (!current) throw new ApiError(404, "邀请不存在", "INVITE_NOT_FOUND");
      if (!updated && current.usedAt) {
        throw new ApiError(409, "邀请已被使用，无法撤销；请在团队成员中调整权限", "INVITE_ALREADY_USED");
      }
      if (updated) {
        adminAudit(request, session, {
          teamId: current.teamId,
          action: "ADMIN_INVITE_REVOKE",
          targetType: "invite",
          targetId: inviteId,
          detail: { role: current.role },
        });
      }
      return { invite: current, alreadyRevoked: !updated };
    });
    const result = operation.immediate();
    return adminOk({ success: true, ...result });
  } catch (error) {
    return adminFail(error);
  }
}
