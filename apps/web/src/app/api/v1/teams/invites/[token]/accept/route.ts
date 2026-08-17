import type { NextRequest } from "next/server";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { userId } = await requireMember(request);
    const { token } = await context.params;
    const invite = db.prepare(
      `SELECT id, team_id AS teamId, role FROM team_invites
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    ).get(hashToken(token)) as { id: string; teamId: string; role: "admin" | "member" | "guest" } | undefined;
    if (!invite) throw new ApiError(410, "邀请已失效或已使用", "INVITE_EXPIRED");
    db.transaction(() => {
      db.prepare(
        `INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(team_id, user_id) DO UPDATE SET role = excluded.role, expires_at = NULL`,
      ).run(invite.teamId, userId, invite.role);
      db.prepare("UPDATE team_invites SET used_at = CURRENT_TIMESTAMP WHERE id = ?").run(invite.id);
    })();
    requireTeamRole(userId, invite.teamId);
    audit({ request, teamId: invite.teamId, actorId: userId, action: "INVITE_ACCEPT", targetType: "invite", targetId: invite.id });
    return ok({ success: true, teamId: invite.teamId });
  } catch (error) {
    return fail(error);
  }
}
