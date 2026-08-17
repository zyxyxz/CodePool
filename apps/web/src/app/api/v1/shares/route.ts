import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getItemForUser, requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import type { ItemRow } from "@/server/items";
import { assertCanCreateShare } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const itemId = request.nextUrl.searchParams.get("itemId") || request.nextUrl.searchParams.get("account_id");
    if (!itemId) return ok([]);
    const item = getItemForUser(userId, itemId) as unknown as ItemRow;
    requireTeamRole(userId, item.team_id, ["owner", "admin", "member"]);
    const canManageTeam = item.role === "owner" || item.role === "admin";
    const shares = db.prepare(
      `SELECT id, item_id AS itemId, expires_at AS expiresAt, max_views AS maxViews,
       view_count AS viewCount, revoked_at AS revokedAt, created_at AS createdAt,
       created_by AS createdBy
       FROM share_links WHERE item_id = ? ORDER BY created_at DESC LIMIT 30`,
    ).all(itemId) as Array<Record<string, unknown> & { createdBy: string }>;
    return ok(
      shares.map((share) => ({
        ...share,
        canRevoke: canManageTeam || share.createdBy === userId,
        can_revoke: canManageTeam || share.createdBy === userId,
      })),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const input = z.object({
      itemId: z.uuid().optional(),
      accountId: z.uuid().optional(),
      account_id: z.uuid().optional(),
      expiresInSec: z.number().int().min(30).max(604_800).optional(),
      expires_in_sec: z.number().int().min(30).max(604_800).optional(),
      maxViews: z.number().int().min(1).max(10_000).default(1),
    }).parse(await jsonBody(request));
    await requireMember(request);
    const itemId = input.itemId || input.accountId || input.account_id;
    if (!itemId) throw new ApiError(422, "缺少 itemId", "INVALID_ITEM_ID");
    const item = getItemForUser(userId, itemId) as unknown as ItemRow;
    requireTeamRole(userId, item.team_id, ["owner", "admin", "member"]);
    enforceRateLimit(request, { namespace: "share-create-user", subject: `user:${userId}`, limit: 120, windowSeconds: 3_600, errorCode: "SHARE_WRITE_RATE_LIMITED" });
    const settings = assertCanCreateShare(itemId);
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expiresIn =
      input.expiresInSec ||
      input.expires_in_sec ||
      settings.defaultShareTtlMinutes * 60;
    if (expiresIn > settings.maxShareTtlMinutes * 60) {
      throw new ApiError(
        422,
        `分享有效期不能超过 ${settings.maxShareTtlMinutes} 分钟`,
        "SHARE_TTL_EXCEEDED",
      );
    }
    if (input.maxViews > settings.maxShareViews) {
      throw new ApiError(
        422,
        `分享领取次数不能超过 ${settings.maxShareViews} 次`,
        "SHARE_VIEWS_EXCEEDED",
      );
    }
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    db.prepare(
      `INSERT INTO share_links(id, token_hash, item_id, created_by, expires_at, max_views)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, hashToken(token), itemId, userId, expiresAt, input.maxViews);
    audit({ request, teamId: item.team_id, actorId: userId, action: "SHARE_CREATE", targetType: item.kind, targetId: itemId, detail: { shareId: id, expiresAt, maxViews: input.maxViews } });
    return ok(
      {
        id,
        token,
        itemId,
        item_id: itemId,
        expiresAt,
        expires_at: expiresAt,
        maxViews: input.maxViews,
        max_views: input.maxViews,
      },
      { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return fail(error);
  }
}
