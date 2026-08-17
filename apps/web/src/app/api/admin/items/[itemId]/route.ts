import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAudit, adminFail, adminOk, requireAdminRequest } from "@/server/admin";
import { ApiError, jsonBody } from "@/server/api";
import { db } from "@/server/db";

type Context = { params: Promise<{ itemId: string }> };
type ItemAdminRow = {
  id: string;
  teamId: string;
  kind: string;
  title: string;
  status: "active" | "disabled";
};

function getItem(itemId: string) {
  return db
    .prepare(
      `SELECT id, team_id AS teamId, kind, title, status
       FROM vault_items WHERE id = ?`,
    )
    .get(itemId) as ItemAdminRow | undefined;
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { itemId } = await context.params;
    z.uuid().parse(itemId);
    const input = z
      .object({
        status: z.enum(["active", "disabled"]),
        reason: z.string().trim().max(300).optional(),
      })
      .strict()
      .parse(await jsonBody(request));
    const current = getItem(itemId);
    if (!current) throw new ApiError(404, "内容不存在", "ITEM_NOT_FOUND");
    const reason = input.status === "disabled" ? input.reason || "管理员停用" : null;
    const revokedShares = db.transaction(() => {
      const revoked = input.status === "disabled"
        ? db.prepare("UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP WHERE item_id = ? AND revoked_at IS NULL").run(itemId).changes
        : 0;
      db.prepare(
        `UPDATE vault_items SET status = ?,
          disabled_at = CASE WHEN ? = 'disabled' THEN COALESCE(disabled_at, CURRENT_TIMESTAMP) ELSE NULL END,
          disabled_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(input.status, input.status, reason, itemId);
      adminAudit(request, session, {
        teamId: current.teamId,
        action: "ADMIN_ITEM_STATUS_UPDATE",
        targetType: current.kind,
        targetId: itemId,
        detail: { previousStatus: current.status, status: input.status, reason, revokedShares: revoked },
      });
      return revoked;
    })();
    const item = db
      .prepare(
        `SELECT id, team_id AS teamId, kind, title, identifier, language, status,
          expires_at AS expiresAt, disabled_at AS disabledAt,
          disabled_reason AS disabledReason, created_at AS createdAt, updated_at AS updatedAt
         FROM vault_items WHERE id = ?`,
      )
      .get(itemId);
    return adminOk({ item, revokedShares });
  } catch (error) {
    return adminFail(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireAdminRequest(request, true);
    const { itemId } = await context.params;
    z.uuid().parse(itemId);
    const current = getItem(itemId);
    if (!current) throw new ApiError(404, "内容不存在", "ITEM_NOT_FOUND");
    const shareCount = (db.prepare("SELECT COUNT(*) AS value FROM share_links WHERE item_id = ?").get(itemId) as { value: number }).value;
    db.transaction(() => {
      db.prepare("DELETE FROM vault_items WHERE id = ?").run(itemId);
      adminAudit(request, session, {
        teamId: current.teamId,
        action: "ADMIN_ITEM_DELETE",
        targetType: current.kind,
        targetId: itemId,
        detail: { title: current.title, previousStatus: current.status, deletedShares: shareCount },
      });
    })();
    return adminOk({ success: true, id: itemId, deletedShares: shareCount });
  } catch (error) {
    return adminFail(error);
  }
}
