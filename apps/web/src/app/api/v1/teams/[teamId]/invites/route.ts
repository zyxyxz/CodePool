import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { created, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";

type Context = { params: Promise<{ teamId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { teamId } = await context.params;
    requireTeamRole(userId, teamId, ["owner", "admin"]);
    return ok(
      db.prepare(
        `SELECT id, role, expires_at AS expiresAt, used_at AS usedAt, created_at AS createdAt
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
    requireTeamRole(userId, teamId, ["owner", "admin"]);
    const input = z
      .object({ role: z.enum(["admin", "member", "guest"]).default("member"), expiresInHours: z.number().int().min(1).max(168).default(24) })
      .parse(await jsonBody(request));
    const token = randomBytes(24).toString("base64url");
    const inviteId = randomUUID();
    const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000).toISOString();
    db.prepare(
      `INSERT INTO team_invites(id, team_id, token_hash, role, created_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(inviteId, teamId, hashToken(token), input.role, userId, expiresAt);
    audit({ request, teamId, actorId: userId, action: "INVITE_CREATE", targetType: "invite", targetId: inviteId, detail: { role: input.role, expiresAt } });
    return created({ id: inviteId, token, role: input.role, expiresAt });
  } catch (error) {
    return fail(error);
  }
}
