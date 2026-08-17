import type { NextRequest } from "next/server";
import { audit } from "@/server/audit";
import { ApiError, fail, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { hashToken } from "@/server/crypto";
import { db } from "@/server/db";
import { inviteAcceptanceSettings } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

type ClaimedInvite = {
  id: string;
  team_id: string;
  role: "admin" | "member" | "guest";
};

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { userId } = await requireMember(request);
    const { token } = await context.params;
    const settings = inviteAcceptanceSettings();
    enforceRateLimit(request, {
      namespace: "invite-accept-user",
      subject: `user:${userId}`,
      limit: 30,
      windowSeconds: 3_600,
      errorCode: "INVITE_ACCEPT_RATE_LIMITED",
    });

    const invite = db.transaction(() => {
      const claimed = db
        .prepare(
          `UPDATE team_invites
           SET used_at = CURRENT_TIMESTAMP
           WHERE token_hash = ?
           AND used_at IS NULL
           AND revoked_at IS NULL
           AND datetime(expires_at) > CURRENT_TIMESTAMP
           AND EXISTS (
             SELECT 1 FROM teams
             WHERE teams.id = team_invites.team_id AND teams.status = 'active'
           )
           RETURNING id, team_id, role`,
        )
        .get(hashToken(token)) as ClaimedInvite | undefined;
      if (!claimed) {
        throw new ApiError(410, "邀请已失效或已使用", "INVITE_EXPIRED");
      }

      const existing = db
        .prepare(
          `SELECT role,
           CASE WHEN expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP
             THEN 1 ELSE 0 END AS active
           FROM team_members WHERE team_id = ? AND user_id = ?`,
        )
        .get(claimed.team_id, userId) as { role: string; active: number } | undefined;
      if (!existing?.active) {
        const memberCount = db
          .prepare(
            `SELECT COUNT(*) AS count FROM team_members tm
             JOIN users u ON u.id = tm.user_id
             WHERE tm.team_id = ? AND u.status = 'active'
             AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)`,
          )
          .get(claimed.team_id) as { count: number };
        if (memberCount.count >= settings.maxMembersPerTeam) {
          throw new ApiError(
            409,
            `团队成员数已达到上限（${settings.maxMembersPerTeam}）`,
            "MEMBER_QUOTA_EXCEEDED",
          );
        }
      }

      db.prepare(
        `INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT(team_id, user_id) DO UPDATE SET
           role = CASE
             WHEN team_members.role = 'owner' THEN 'owner'
             ELSE excluded.role
           END,
           expires_at = NULL`,
      ).run(claimed.team_id, userId, claimed.role);
      audit({
        request,
        teamId: claimed.team_id,
        actorId: userId,
        action: "INVITE_ACCEPT",
        targetType: "invite",
        targetId: claimed.id,
      });
      return claimed;
    })();
    return ok(
      {
        success: true,
        teamId: invite.team_id,
        team_id: invite.team_id,
        role: invite.role,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const response = fail(error);
    Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
