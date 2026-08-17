import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { created, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { encrypt } from "@/server/crypto";
import { db } from "@/server/db";
import { itemSummary, type ItemRow } from "@/server/items";
import { assertCanCreateItem } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

const createSchema = z.object({
  teamId: z.uuid(),
  kind: z.enum(["code", "snippet", "secret", "note"]),
  title: z.string().trim().min(1).max(120),
  content: z.string().min(1).max(200_000),
  identifier: z.string().trim().max(160).nullable().optional(),
  language: z.string().trim().max(40).nullable().optional(),
  expiresAt: z.iso.datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const teamId = request.nextUrl.searchParams.get("teamId") || request.nextUrl.searchParams.get("team_id");
    const kind = request.nextUrl.searchParams.get("kind");
    const query = request.nextUrl.searchParams.get("q")?.trim();
    if (!teamId) return ok([]);
    requireTeamRole(userId, teamId);
    const clauses = [
      "team_id = ?",
      "status = 'active'",
      "(expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)",
    ];
    const values: unknown[] = [teamId];
    if (kind) {
      clauses.push("kind = ?");
      values.push(kind);
    }
    if (query) {
      clauses.push("(title LIKE ? OR identifier LIKE ?)");
      values.push(`%${query}%`, `%${query}%`);
    }
    const rows = db
      .prepare(`SELECT * FROM vault_items WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT 200`)
      .all(...values) as ItemRow[];
    return ok(rows.map(itemSummary));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const input = createSchema.parse(await jsonBody(request));
    await requireMember(request);
    requireTeamRole(userId, input.teamId, ["owner", "admin", "member"]);
    enforceRateLimit(request, { namespace: "item-create-user", subject: `user:${userId}`, limit: 120, windowSeconds: 3_600, errorCode: "ITEM_WRITE_RATE_LIMITED" });
    enforceRateLimit(request, { namespace: "item-create-team", subject: `team:${input.teamId}`, limit: 600, windowSeconds: 3_600, errorCode: "ITEM_WRITE_RATE_LIMITED" });
    assertCanCreateItem(input.teamId);
    const id = randomUUID();
    const encrypted = encrypt(input.content);
    db.prepare(
      `INSERT INTO vault_items
       (id, team_id, kind, title, identifier, language, cipher_text, iv, auth_tag, metadata, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.teamId,
      input.kind,
      input.title,
      input.identifier || null,
      input.language || null,
      encrypted.cipherText,
      encrypted.iv,
      encrypted.authTag,
      JSON.stringify(input.metadata),
      input.expiresAt || null,
      userId,
    );
    audit({ request, teamId: input.teamId, actorId: userId, action: "ITEM_CREATE", targetType: input.kind, targetId: id });
    const row = db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id) as ItemRow;
    return created(itemSummary(row));
  } catch (error) {
    return fail(error);
  }
}
