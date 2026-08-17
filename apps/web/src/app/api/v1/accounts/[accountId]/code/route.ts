import type { NextRequest } from "next/server";
import { getItemForUser } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { decrypt } from "@/server/crypto";
import type { ItemRow } from "@/server/items";
import { enforceRateLimit } from "@/server/rate-limit";
import { generateTotp } from "@/server/totp";

export async function GET(request: NextRequest, context: { params: Promise<{ accountId: string }> }) {
  try {
    const { userId } = await requireMember(request);
    const { accountId } = await context.params;
    enforceRateLimit(request, {
      namespace: "totp-reveal-user",
      subject: `user:${userId}`,
      limit: 120,
      windowSeconds: 60,
      errorCode: "TOTP_REVEAL_RATE_LIMITED",
    });
    enforceRateLimit(request, {
      namespace: "totp-reveal-item",
      subject: `user:${userId}:item:${accountId}`,
      limit: 12,
      windowSeconds: 60,
      errorCode: "TOTP_REVEAL_RATE_LIMITED",
    });
    const row = getItemForUser(userId, accountId) as unknown as ItemRow;
    if (row.kind !== "totp") throw new ApiError(404, "动态验证码不存在", "ACCOUNT_NOT_FOUND");
    const metadata = JSON.parse(row.metadata) as { algorithm?: string; digits?: number; period?: number };
    const secret = decrypt({ cipherText: row.cipher_text, iv: row.iv, authTag: row.auth_tag });
    const result = generateTotp(secret, metadata);
    audit({ request, teamId: row.team_id, actorId: userId, action: "TOTP_VIEW", targetType: "totp", targetId: accountId });
    return ok(result, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return fail(error);
  }
}
