import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { created, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { encrypt } from "@/server/crypto";
import { db } from "@/server/db";
import { accountSummary, type ItemRow } from "@/server/items";
import { assertCanCreateItem } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";
import { parseOtpAuth } from "@/server/totp";

const schema = z.object({
  teamId: z.uuid().optional(),
  team_id: z.uuid().optional(),
  otpauthUrl: z.string().optional(),
  otpauth_url: z.string().optional(),
  issuer: z.string().trim().min(1).max(120).optional(),
  label: z.string().trim().min(1).max(160).optional(),
  accountIdentifier: z.string().trim().max(160).optional(),
  account_identifier: z.string().trim().max(160).optional(),
  secret: z.string().optional(),
  algorithm: z.enum(["SHA1", "SHA256", "SHA512"]).default("SHA1"),
  digits: z.union([z.literal(6), z.literal(8)]).default(6),
  period: z.number().int().min(15).max(120).default(30),
  remark: z.string().trim().max(500).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const teamId = request.nextUrl.searchParams.get("teamId") || request.nextUrl.searchParams.get("team_id");
    const query = request.nextUrl.searchParams.get("q")?.trim();
    if (!teamId) return ok([]);
    requireTeamRole(userId, teamId);
    const rows = query
      ? db.prepare(
          `SELECT * FROM vault_items WHERE team_id = ? AND kind = 'totp'
           AND status = 'active'
           AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
           AND (title LIKE ? OR identifier LIKE ?) ORDER BY updated_at DESC`,
        ).all(teamId, `%${query}%`, `%${query}%`)
      : db.prepare(
          `SELECT * FROM vault_items WHERE team_id = ? AND kind = 'totp'
           AND status = 'active'
           AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
           ORDER BY updated_at DESC`,
        ).all(teamId);
    return ok((rows as ItemRow[]).map(accountSummary));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const input = schema.parse(await jsonBody(request));
    await requireMember(request);
    const teamId = input.teamId || input.team_id;
    if (!teamId) throw new z.ZodError([]);
    requireTeamRole(userId, teamId, ["owner", "admin"]);
    enforceRateLimit(request, { namespace: "item-create-user", subject: `user:${userId}`, limit: 120, windowSeconds: 3_600, errorCode: "ITEM_WRITE_RATE_LIMITED" });
    enforceRateLimit(request, { namespace: "item-create-team", subject: `team:${teamId}`, limit: 600, windowSeconds: 3_600, errorCode: "ITEM_WRITE_RATE_LIMITED" });
    assertCanCreateItem(teamId);
    const otpUrl = input.otpauthUrl || input.otpauth_url;
    const parsed = otpUrl
      ? parseOtpAuth(otpUrl)
      : {
          secret: input.secret || "",
          issuer: input.issuer || "",
          label: input.label || input.accountIdentifier || input.account_identifier || "",
          algorithm: input.algorithm,
          digits: input.digits,
          period: input.period,
        };
    const validated = z.object({
      secret: z.string().trim().min(8).max(256),
      issuer: z.string().trim().min(1).max(120),
      label: z.string().trim().min(1).max(160),
      algorithm: z.enum(["SHA1", "SHA256", "SHA512"]),
      digits: z.union([z.literal(6), z.literal(8)]),
      period: z.number().int().min(15).max(120),
    }).parse(parsed);
    const encrypted = encrypt(validated.secret.replace(/\s/g, "").toUpperCase());
    const id = randomUUID();
    const identifier = input.accountIdentifier || input.account_identifier || validated.label;
    const metadata = {
      issuer: validated.issuer,
      label: validated.label,
      algorithm: validated.algorithm,
      digits: validated.digits,
      period: validated.period,
      remark: input.remark || null,
    };
    db.prepare(
      `INSERT INTO vault_items
       (id, team_id, kind, title, identifier, cipher_text, iv, auth_tag, metadata, created_by)
       VALUES (?, ?, 'totp', ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, teamId, validated.issuer, identifier, encrypted.cipherText, encrypted.iv, encrypted.authTag, JSON.stringify(metadata), userId);
    audit({ request, teamId, actorId: userId, action: "TOTP_CREATE", targetType: "totp", targetId: id, detail: { issuer: validated.issuer } });
    return created(accountSummary(db.prepare("SELECT * FROM vault_items WHERE id = ?").get(id) as ItemRow));
  } catch (error) {
    return fail(error);
  }
}
