import type { NextRequest } from "next/server";
import { requireTeamRole } from "@/server/access";
import { fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { signedMemberAvatarUrl } from "@/server/avatar";
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
       a.detail, a.created_at AS createdAt, u.nickname AS actorName,
       u.id AS avatarActorId, u.avatar_url AS actorAvatar,
       u.avatar_version AS actorAvatarVersion
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       WHERE a.team_id = ? ORDER BY a.created_at DESC LIMIT ?`,
    ).all(teamId, limit) as Array<Record<string, unknown> & {
      detail: string;
      avatarActorId: string | null;
      actorAvatar: string | null;
      actorAvatarVersion: number | null;
    }>;
    return ok(logs.map((log) => {
      const { avatarActorId, actorAvatar, actorAvatarVersion, ...publicLog } = log;
      return {
        ...publicLog,
        actorAvatar: avatarActorId && actorAvatarVersion
          ? signedMemberAvatarUrl(avatarActorId, actorAvatarVersion, actorAvatar)
          : null,
        detail: JSON.parse(log.detail || "{}"),
      };
    }));
  } catch (error) {
    return fail(error);
  }
}
