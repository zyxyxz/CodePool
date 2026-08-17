import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import { assertCanCreateInvite } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { teamId } = await context.params;
    requireTeamRole(userId, teamId, ["owner", "admin"]);
    return ok(
      db.prepare(
        `SELECT id, role, expires_at AS expiresAt, used_at AS usedAt,
         revoked_at AS revokedAt, created_at AS createdAt
         FROM team_invites WHERE team_id = ? ORDER BY created_at DESC LIMIT 30`,
      ).all(teamId),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { teamId } = await context.params;
    const input = z
      .object({
        role: z.enum(["admin", "member", "guest"]).default("member"),
        expiresInHours: z.number().int().min(1).max(720).optional(),
        expires_in_hours: z.number().int().min(1).max(720).optional(),
      })
      .parse(await jsonBody(request));
    await requireMember(request);
    requireTeamRole(userId, teamId, ["owner", "admin"]);
    enforceRateLimit(request, { namespace: "invite-create-user", subject: `user:${userId}`, limit: 60, windowSeconds: 3_600, errorCode: "INVITE_WRITE_RATE_LIMITED" });
    enforceRateLimit(request, { namespace: "invite-create-team", subject: `team:${teamId}`, limit: 120, windowSeconds: 3_600, errorCode: "INVITE_WRITE_RATE_LIMITED" });
    const settings = assertCanCreateInvite(teamId);
    const token = randomBytes(24).toString("base64url");
    const inviteId = randomUUID();
    const expiresInHours =
      input.expiresInHours || input.expires_in_hours || settings.defaultInviteTtlHours;
    const expiresAt = new Date(Date.now() + expiresInHours * 3_600_000).toISOString();
    db.prepare(
      `INSERT INTO team_invites(id, team_id, token_hash, role, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(inviteId, teamId, hashToken(token), input.role, userId, expiresAt);
    audit({ request, teamId, actorId: userId, action: "INVITE_CREATE", targetType: "invite", targetId: inviteId, detail: { role: input.role, expiresAt } });
    return ok(
      {
        id: inviteId,
        token,
        role: input.role,
        expiresAt,
        expires_at: expiresAt,
        teamId,
        team_id: teamId,
      },
      { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return fail(error);
  }
}
