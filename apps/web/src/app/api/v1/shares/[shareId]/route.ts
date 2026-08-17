import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { ApiError, fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";
import { enforceRateLimit } from "@/server/rate-limit";

type ShareAccessRow = {
  id: string;
  item_id: string;
  team_id: string;
  team_owner_id: string;
  created_by: string;
  role: "owner" | "admin" | "member" | "guest" | null;
  revoked_at: string | null;
  expires_at: string;
  expired: number;
};

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

function withNoStore(response: Response) {
  Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
  return response;
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ shareId: string }> },
) {
  try {
    const { userId } = await requireMember(request);
    const { shareId } = await context.params;
    z.uuid().parse(shareId);
    enforceRateLimit(request, {
      namespace: "share-revoke-user",
      subject: `user:${userId}`,
      limit: 60,
      windowSeconds: 60,
      errorCode: "SHARE_REVOKE_RATE_LIMITED",
    });

    const share = db
      .prepare(
        `SELECT s.id, s.item_id, s.created_by, s.revoked_at, s.expires_at,
         v.team_id, t.owner_id AS team_owner_id, tm.role,
         CASE WHEN datetime(s.expires_at) <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS expired
         FROM share_links s
         JOIN vault_items v ON v.id = s.item_id
         JOIN teams t ON t.id = v.team_id
         LEFT JOIN team_members tm
           ON tm.team_id = t.id AND tm.user_id = ?
           AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
         WHERE s.id = ? AND t.status = 'active'`,
      )
      .get(userId, shareId) as ShareAccessRow | undefined;
    if (!share) throw new ApiError(404, "分享不存在", "SHARE_NOT_FOUND");

    const canRevoke =
      share.created_by === userId ||
      share.team_owner_id === userId ||
      share.role === "owner" ||
      share.role === "admin";
    if (!canRevoke) {
      throw new ApiError(403, "只有分享创建者或团队管理员可以撤销", "FORBIDDEN");
    }

    const result = db.transaction(() => {
      const updated = db
        .prepare(
          `UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revoked_at IS NULL
           RETURNING revoked_at`,
        )
        .get(shareId) as { revoked_at: string } | undefined;
      if (updated) {
        audit({
          request,
          teamId: share.team_id,
          actorId: userId,
          action: "SHARE_REVOKE",
          targetType: "share",
          targetId: shareId,
          detail: { itemId: share.item_id },
        });
      }
      const current = updated || (db
        .prepare("SELECT revoked_at FROM share_links WHERE id = ?")
        .get(shareId) as { revoked_at: string | null } | undefined);
      if (!current) throw new ApiError(404, "分享不存在", "SHARE_NOT_FOUND");
      return {
        revokedAt: current.revoked_at || share.revoked_at,
        alreadyRevoked: !updated,
      };
    })();

    return ok(
      {
        success: true,
        id: shareId,
        shareId,
        share_id: shareId,
        itemId: share.item_id,
        item_id: share.item_id,
        revokedAt: result.revokedAt,
        revoked_at: result.revokedAt,
        alreadyRevoked: result.alreadyRevoked,
        already_revoked: result.alreadyRevoked,
        expired: Boolean(share.expired),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return withNoStore(fail(error));
  }
}
