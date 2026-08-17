import type { NextRequest } from "next/server";
import { z } from "zod";
import { getItemForUser, requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { encrypt } from "@/server/crypto";
import { db } from "@/server/db";
import { itemSummary, revealItem, type ItemRow } from "@/server/items";

type Context = { params: Promise<{ itemId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { itemId } = await context.params;
    const row = getItemForUser(userId, itemId) as unknown as ItemRow;
    audit({ request, teamId: row.team_id, actorId: userId, action: "ITEM_REVEAL", targetType: row.kind, targetId: itemId });
    return ok(revealItem(row));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { itemId } = await context.params;
    const row = getItemForUser(userId, itemId) as unknown as ItemRow;
    requireTeamRole(userId, row.team_id, ["owner", "admin", "member"]);
    const input = z.object({
      title: z.string().trim().min(1).max(120).optional(),
      content: z.string().min(1).max(200_000).optional(),
      identifier: z.string().trim().max(160).nullable().optional(),
      language: z.string().trim().max(40).nullable().optional(),
      expiresAt: z.iso.datetime().nullable().optional(),
    }).parse(await jsonBody(request));
    const encrypted = input.content ? encrypt(input.content) : null;
    db.prepare(
      `UPDATE vault_items SET title = COALESCE(?, title),
       identifier = CASE WHEN ? = 1 THEN ? ELSE identifier END,
       language = CASE WHEN ? = 1 THEN ? ELSE language END,
       expires_at = CASE WHEN ? = 1 THEN ? ELSE expires_at END,
       cipher_text = COALESCE(?, cipher_text), iv = COALESCE(?, iv), auth_tag = COALESCE(?, auth_tag),
       updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(
      input.title || null,
      input.identifier === undefined ? 0 : 1,
      input.identifier ?? null,
      input.language === undefined ? 0 : 1,
      input.language ?? null,
      input.expiresAt === undefined ? 0 : 1,
      input.expiresAt ?? null,
      encrypted?.cipherText || null,
      encrypted?.iv || null,
      encrypted?.authTag || null,
      itemId,
    );
    audit({ request, teamId: row.team_id, actorId: userId, action: "ITEM_UPDATE", targetType: row.kind, targetId: itemId });
    return ok(itemSummary(db.prepare("SELECT * FROM vault_items WHERE id = ?").get(itemId) as ItemRow));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { itemId } = await context.params;
    const row = getItemForUser(userId, itemId) as unknown as ItemRow;
    requireTeamRole(userId, row.team_id, ["owner", "admin"]);
    db.prepare("DELETE FROM vault_items WHERE id = ?").run(itemId);
    audit({ request, teamId: row.team_id, actorId: userId, action: "ITEM_DELETE", targetType: row.kind, targetId: itemId });
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
