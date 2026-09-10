import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { fail, jsonBody, ok } from "@/server/api";
import { assertMemberSession, requireMember } from "@/server/auth";
import { db } from "@/server/db";
import { writablePlatformSettings } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";
import { teamNameSchema, teamThemeColorSchema } from "@/server/teams";

const schema = z.object({ name: teamNameSchema.optional(), themeColor: teamThemeColorSchema.optional() })
  .strict().refine((value) => Object.keys(value).length > 0, "至少需要修改一项团队信息");

export async function PATCH(request: NextRequest, context: { params: Promise<{ teamId: string }> }) {
  try {
    const session = await requireMember(request);
    const { teamId } = await context.params;
    const input = schema.parse(await jsonBody(request));
    const value = db.transaction(() => {
      assertMemberSession(session);
      const membership = requireTeamRole(session.userId, teamId, ["owner", "admin"]);
      writablePlatformSettings();
      enforceRateLimit(request, { namespace: "team-update-user", subject: `user:${session.userId}`, limit: 60, windowSeconds: 3_600, errorCode: "TEAM_WRITE_RATE_LIMITED" });
      enforceRateLimit(request, { namespace: "team-update-team", subject: `team:${teamId}`, limit: 60, windowSeconds: 3_600, errorCode: "TEAM_WRITE_RATE_LIMITED" });
      db.prepare(`UPDATE teams SET name = COALESCE(?, name), theme_color = COALESCE(?, theme_color),
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(input.name ?? null, input.themeColor ?? null, teamId);
      audit({ request, teamId, actorId: session.userId, action: "TEAM_UPDATE", targetType: "team", targetId: teamId, detail: { fields: Object.keys(input) } });
      const team = db.prepare(`SELECT t.id AS teamId, t.name, t.slug, t.owner_id AS ownerId,
        t.theme_color AS themeColor, t.created_at AS createdAt, t.updated_at AS updatedAt,
        (SELECT COUNT(*) FROM team_members x JOIN users member_u ON member_u.id = x.user_id
          WHERE x.team_id = t.id AND member_u.status = 'active'
          AND (x.expires_at IS NULL OR datetime(x.expires_at) > CURRENT_TIMESTAMP)) AS memberCount,
        (SELECT COUNT(*) FROM vault_items v WHERE v.team_id = t.id) AS itemCount
        FROM teams t WHERE t.id = ?`).get(teamId) as Record<string, unknown>;
      return { ...team, role: membership.role };
    }).immediate();
    return ok(value);
  } catch (error) {
    return fail(error);
  }
}
