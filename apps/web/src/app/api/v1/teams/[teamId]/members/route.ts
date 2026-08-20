import type { NextRequest } from "next/server";
import { fail, ok } from "@/server/api";
import { requireTeamRole } from "@/server/access";
import { requireMember } from "@/server/auth";
import { signedMemberAvatarUrl } from "@/server/avatar";
import { db } from "@/server/db";

export async function GET(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  try {
    const { userId } = await requireMember(request);
    const { teamId } = await context.params;
    requireTeamRole(userId, teamId);
    const members = db
      .prepare(
        `SELECT u.id AS userId, u.nickname, u.avatar_url AS avatarUrl,
         u.avatar_version AS avatarVersion, u.status,
         tm.role, tm.expires_at AS expiresAt, tm.joined_at AS joinedAt
         FROM team_members tm JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ? ORDER BY CASE tm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, tm.joined_at`,
      )
      .all(teamId) as Array<{
        userId: string;
        avatarUrl: string | null;
        avatarVersion: number;
        [key: string]: unknown;
      }>;
    return ok(members.map((member) => {
      const { avatarVersion, ...publicMember } = member;
      return {
        ...publicMember,
        avatarUrl: signedMemberAvatarUrl(member.userId, avatarVersion, member.avatarUrl),
      };
    }));
  } catch (error) {
    return fail(error);
  }
}
