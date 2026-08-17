import type { NextRequest } from "next/server";
import { audit } from "@/server/audit";
import { ApiError, fail, ok } from "@/server/api";
import { decrypt, hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import { itemSummary, type ItemRow } from "@/server/items";
import { generateTotp } from "@/server/totp";

type ShareRow = ItemRow & { share_id: string; view_count: number; max_views: number };

export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const row = db.prepare(
      `SELECT v.*, s.id AS share_id, s.view_count, s.max_views
       FROM share_links s JOIN vault_items v ON v.id = s.item_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
       AND s.view_count < s.max_views
       AND (v.expires_at IS NULL OR v.expires_at > CURRENT_TIMESTAMP)`,
    ).get(hashToken(token)) as ShareRow | undefined;
    if (!row) throw new ApiError(410, "分享链接已过期、已撤销或已领取", "SHARE_EXPIRED");
    const consumed = db.prepare(
      `UPDATE share_links SET view_count = view_count + 1
       WHERE id = ? AND view_count < max_views AND revoked_at IS NULL`,
    ).run(row.share_id);
    if (!consumed.changes) throw new ApiError(410, "分享链接已领取", "SHARE_CONSUMED");
    const content = decrypt({ cipherText: row.cipher_text, iv: row.iv, authTag: row.auth_tag });
    const value = row.kind === "totp"
      ? { ...itemSummary(row), ...generateTotp(content, JSON.parse(row.metadata)) }
      : { ...itemSummary(row), content };
    audit({ request, teamId: row.team_id, action: "SHARE_REDEEM", targetType: row.kind, targetId: row.id, detail: { shareId: row.share_id } });
    return ok(value);
  } catch (error) {
    return fail(error);
  }
}
