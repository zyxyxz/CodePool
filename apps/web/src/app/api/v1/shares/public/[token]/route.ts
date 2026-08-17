import type { NextRequest } from "next/server";
import { audit } from "@/server/audit";
import { ApiError, fail, ok } from "@/server/api";
import { decrypt, hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import { itemSummary, type ItemRow } from "@/server/items";
import { writablePlatformSettings } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";
import { generateTotp } from "@/server/totp";

type Context = { params: Promise<{ token: string }> };
type SharePreviewRow = {
  share_id: string;
  item_id: string;
  kind: ItemRow["kind"];
  title: string;
  language: string | null;
  share_expires_at: string;
  item_expires_at: string | null;
  view_count: number;
  max_views: number;
};
type ClaimedShare = { id: string; item_id: string };

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function findPreview(tokenHash: string) {
  const row = db
    .prepare(
      `SELECT s.id AS share_id, s.item_id, s.expires_at AS share_expires_at,
       s.view_count, s.max_views, v.kind, v.title, v.language,
       v.expires_at AS item_expires_at
       FROM share_links s
       JOIN vault_items v ON v.id = s.item_id
       JOIN teams t ON t.id = v.team_id
       WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND datetime(s.expires_at) > CURRENT_TIMESTAMP
       AND s.view_count < s.max_views
       AND v.status = 'active'
       AND t.status = 'active'
       AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)`,
    )
    .get(tokenHash) as SharePreviewRow | undefined;
  if (!row) {
    throw new ApiError(410, "分享链接已过期、已撤销或已领完", "SHARE_EXPIRED");
  }
  return row;
}

function previewResponse(row: SharePreviewRow) {
  // Do not return identifier, metadata, encrypted fields, TOTP seed, or content here.
  return {
    id: row.item_id,
    kind: row.kind,
    title: row.title,
    language: row.language,
    expiresAt: row.item_expires_at,
    share: {
      expiresAt: row.share_expires_at,
      maxViews: row.max_views,
      remainingViews: Math.max(0, row.max_views - row.view_count),
    },
  };
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    enforceRateLimit(request, {
      namespace: "share-preview-ip",
      limit: 120,
      windowSeconds: 60,
      errorCode: "SHARE_PREVIEW_RATE_LIMITED",
    });
    return ok(previewResponse(findPreview(hashToken(token))), { headers: NO_STORE_HEADERS });
  } catch (error) {
    const response = fail(error);
    Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}

export async function HEAD(request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    enforceRateLimit(request, {
      namespace: "share-preview-ip",
      limit: 120,
      windowSeconds: 60,
      errorCode: "SHARE_PREVIEW_RATE_LIMITED",
    });
    findPreview(hashToken(token));
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    const headers = new Headers(error instanceof ApiError ? error.headers : undefined);
    Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => headers.set(name, value));
    return new Response(null, { status, headers });
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { token } = await context.params;
    const tokenHash = hashToken(token);
    enforceRateLimit(request, {
      namespace: "share-redeem-ip",
      limit: 30,
      windowSeconds: 60,
      errorCode: "SHARE_REDEEM_RATE_LIMITED",
    });
    enforceRateLimit(request, {
      namespace: "share-redeem-token",
      subject: `share:${tokenHash}`,
      limit: 120,
      windowSeconds: 60,
      errorCode: "SHARE_REDEEM_RATE_LIMITED",
    });
    writablePlatformSettings();

    const value = db.transaction(() => {
      const claimed = db
        .prepare(
          `UPDATE share_links
           SET view_count = view_count + 1
           WHERE token_hash = ?
           AND revoked_at IS NULL
           AND datetime(expires_at) > CURRENT_TIMESTAMP
           AND view_count < max_views
           AND EXISTS (
             SELECT 1 FROM vault_items v
             JOIN teams t ON t.id = v.team_id
             WHERE v.id = share_links.item_id
             AND v.status = 'active'
             AND t.status = 'active'
             AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)
           )
           RETURNING id, item_id`,
        )
        .get(tokenHash) as ClaimedShare | undefined;
      if (!claimed) {
        throw new ApiError(410, "分享链接已过期、已撤销或已领完", "SHARE_EXPIRED");
      }

      const row = db
        .prepare("SELECT * FROM vault_items WHERE id = ?")
        .get(claimed.item_id) as ItemRow | undefined;
      if (!row) {
        throw new ApiError(410, "分享内容已不可用", "SHARE_EXPIRED");
      }
      const content = decrypt({
        cipherText: row.cipher_text,
        iv: row.iv,
        authTag: row.auth_tag,
      });
      const revealed =
        row.kind === "totp"
          ? { ...itemSummary(row), ...generateTotp(content, JSON.parse(row.metadata)) }
          : { ...itemSummary(row), content };
      audit({
        request,
        teamId: row.team_id,
        action: "SHARE_REDEEM",
        targetType: row.kind,
        targetId: row.id,
        detail: { shareId: claimed.id },
      });
      return revealed;
    })();

    return ok(value, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const response = fail(error);
    Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
