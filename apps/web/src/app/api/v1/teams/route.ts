import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { created, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const teams = db
      .prepare(
        `SELECT t.id AS teamId, t.name, t.slug, t.owner_id AS ownerId, tm.role,
         t.created_at AS createdAt,
         (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS memberCount,
         (SELECT COUNT(*) FROM vault_items v WHERE v.team_id = t.id) AS itemCount
         FROM teams t JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ? ORDER BY t.updated_at DESC`,
      )
      .all(userId);
    return ok(teams);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const input = z.object({ name: z.string().trim().min(2).max(48) }).parse(await jsonBody(request));
    const teamId = randomUUID();
    const slug = `${input.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 24) || "pool"}-${teamId.slice(0, 6)}`;
    db.transaction(() => {
      db.prepare("INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)").run(
        teamId,
        input.name,
        slug,
        userId,
      );
      db.prepare("INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, 'owner')").run(
        teamId,
        userId,
      );
    })();
    audit({ request, teamId, actorId: userId, action: "TEAM_CREATE", targetType: "team", targetId: teamId });
    return created({ teamId, name: input.name, slug, ownerId: userId, role: "owner" });
  } catch (error) {
    return fail(error);
  }
}
