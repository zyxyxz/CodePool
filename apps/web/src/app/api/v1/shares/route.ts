import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getItemForUser, requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, created, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import type { ItemRow } from "@/server/items";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const itemId = request.nextUrl.searchParams.get("itemId") || request.nextUrl.searchParams.get("account_id");
    if (!itemId) return ok([]);
    const item = getItemForUser(userId, itemId) as unknown as ItemRow;
    requireTeamRole(userId, item.team_id, ["owner", "admin", "member"]);
    return ok(db.prepare(
      `SELECT id, item_id AS itemId, expires_at AS expiresAt, max_views AS maxViews,
       view_count AS viewCount, revoked_at AS revokedAt, created_at AS createdAt
       FROM share_links WHERE item_id = ? ORDER BY created_at DESC LIMIT 30`,
    ).all(itemId));
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
      expiresInSec: z.number().int().min(30).max(86_400).optional(),
      expires_in_sec: z.number().int().min(30).max(86_400).optional(),
      maxViews: z.number().int().min(1).max(20).default(1),
    }).parse(await jsonBody(request));
    const itemId = input.itemId || input.accountId || input.account_id;
    if (!itemId) throw new ApiError(422, "缺少 itemId", "INVALID_ITEM_ID");
    const item = getItemForUser(userId, itemId) as unknown as ItemRow;
    requireTeamRole(userId, item.team_id, ["owner", "admin", "member"]);
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    const expiresIn = input.expiresInSec || input.expires_in_sec || 300;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    db.prepare(
      `INSERT INTO share_links(id, token_hash, item_id, created_by, expires_at, max_views)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, hashToken(token), itemId, userId, expiresAt, input.maxViews);
    audit({ request, teamId: item.team_id, actorId: userId, action: "SHARE_CREATE", targetType: item.kind, targetId: itemId, detail: { shareId: id, expiresAt, maxViews: input.maxViews } });
    return created({ id, token, itemId, expiresAt, maxViews: input.maxViews });
  } catch (error) {
    return fail(error);
  }
}
