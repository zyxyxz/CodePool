import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAudit, adminFail, adminOk, requireAdminRequest } from "@/server/admin";
import { ApiError } from "@/server/api";
import { db } from "@/server/db";

type Context = { params: Promise<{ shareId: string }> };

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { shareId } = await context.params;
    z.uuid().parse(shareId);
    const share = db
      .prepare(
        `SELECT s.id, s.revoked_at AS revokedAt, v.id AS itemId,
          v.kind, v.team_id AS teamId
         FROM share_links s JOIN vault_items v ON v.id = s.item_id WHERE s.id = ?`,
      )
      .get(shareId) as { id: string; revokedAt: string | null; itemId: string; kind: string; teamId: string } | undefined;
    if (!share) throw new ApiError(404, "分享不存在", "SHARE_NOT_FOUND");
    if (!share.revokedAt) {
      db.transaction(() => {
        db.prepare("UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL").run(shareId);
        adminAudit(request, session, {
          teamId: share.teamId,
          action: "ADMIN_SHARE_REVOKE",
          targetType: "share",
          targetId: shareId,
          detail: { itemId: share.itemId, itemKind: share.kind },
        });
      })();
    }
    const result = db
      .prepare("SELECT id, revoked_at AS revokedAt FROM share_links WHERE id = ?")
      .get(shareId);
    return adminOk({ success: true, share: result, alreadyRevoked: Boolean(share.revokedAt) });
  } catch (error) {
    return adminFail(error);
  }
}
