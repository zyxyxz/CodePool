import type { NextRequest } from "next/server";
import { fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  try {
    const session = await requireMember(request);
    const user = db
      .prepare(
        `SELECT id, open_id AS openId, nickname, avatar_url AS avatarUrl,
         created_at AS createdAt, last_login_at AS lastLoginAt
         FROM users WHERE id = ? AND status = 'active'`,
      )
      .get(session.userId);
    if (!user) throw new Error("UNAUTHORIZED");
    const teams = db
      .prepare(
        `SELECT t.id AS teamId, t.name, t.slug, t.owner_id AS ownerId, tm.role,
         tm.expires_at AS expiresAt, t.created_at AS createdAt
         FROM teams t JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ? ORDER BY t.updated_at DESC`,
      )
      .all(session.userId);
    return ok({ user, teams });
  } catch (error) {
    return fail(error);
  }
}
