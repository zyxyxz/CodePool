import type { NextRequest } from "next/server";
import { requireTeamRole } from "@/server/access";
import { fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    const teamId = request.nextUrl.searchParams.get("teamId") || request.nextUrl.searchParams.get("team_id");
    if (!teamId) return ok([]);
    requireTeamRole(userId, teamId);
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") || 100), 200);
    const logs = db.prepare(
      `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
       a.detail, a.created_at AS createdAt, u.nickname AS actorName, u.avatar_url AS actorAvatar
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.team_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    ).all(teamId, limit) as Array<Record<string, unknown> & { detail: string }>;
    return ok(logs.map((log) => ({ ...log, detail: JSON.parse(log.detail || "{}") })));
  } catch (error) {
    return fail(error);
  }
}
