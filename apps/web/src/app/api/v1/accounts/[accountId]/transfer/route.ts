import type { NextRequest } from "next/server";
import { z } from "zod";
import { getItemForUser, requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { assertMemberSession, requireMember } from "@/server/auth";
import { db } from "@/server/db";
import { accountSummary, type ItemRow } from "@/server/items";
import { assertCanCreateItem } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ accountId: string }> };
const schema = z.object({ sourceTeamId: z.uuid(), targetTeamId: z.uuid() }).strict();

export async function POST(request: NextRequest, context: Context) {
  try {
    const session = await requireMember(request);
    const { accountId } = await context.params;
    const input = schema.parse(await jsonBody(request));
    const value = db.transaction(() => {
      assertMemberSession(session);
      const { userId } = session;
      requireTeamRole(userId, input.sourceTeamId, ["owner", "admin"]);
      requireTeamRole(userId, input.targetTeamId, ["owner", "admin"]);
      if (input.sourceTeamId === input.targetTeamId) {
        throw new ApiError(422, "请选择其他团队空间", "SAME_TEAM_TRANSFER");
      }

      const row = getItemForUser(userId, accountId) as unknown as ItemRow;
      if (row.kind !== "totp") {
        throw new ApiError(404, "动态验证码不存在", "ACCOUNT_NOT_FOUND");
      }
      if (row.team_id !== input.sourceTeamId) {
        throw new ApiError(409, "这条动态验证码已转移，请刷新后重试", "ACCOUNT_TEAM_CHANGED");
      }
      enforceRateLimit(request, { namespace: "account-transfer-user", subject: `user:${userId}`, limit: 60, windowSeconds: 3_600, errorCode: "ACCOUNT_TRANSFER_RATE_LIMITED" });
      enforceRateLimit(request, { namespace: "account-transfer-item", subject: `item:${accountId}`, limit: 20, windowSeconds: 3_600, errorCode: "ACCOUNT_TRANSFER_RATE_LIMITED" });
      assertCanCreateItem(input.targetTeamId);

      // Encryption is independent of team ownership. Move the existing row and
      // preserve its encrypted seed, identity, metadata, and creator unchanged.
      db.prepare("UPDATE vault_items SET team_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND team_id = ?")
        .run(input.targetTeamId, accountId, input.sourceTeamId);
      const revokedShareCount = db.prepare(
        "UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP WHERE item_id = ? AND revoked_at IS NULL",
      ).run(accountId).changes;
      const detail = { ...input, revokedShareCount };
      audit({ request, teamId: input.sourceTeamId, actorId: userId, action: "TOTP_TRANSFER_OUT", targetType: "totp", targetId: accountId, detail });
      audit({ request, teamId: input.targetTeamId, actorId: userId, action: "TOTP_TRANSFER_IN", targetType: "totp", targetId: accountId, detail });
      return {
        account: accountSummary(db.prepare("SELECT * FROM vault_items WHERE id = ?").get(accountId) as ItemRow),
        revokedShareCount,
      };
    }).immediate();
    return ok(value);
  } catch (error) {
    return fail(error);
  }
}
