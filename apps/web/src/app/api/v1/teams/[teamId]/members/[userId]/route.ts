import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";

type Context = { params: Promise<{ teamId: string; userId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const session = await requireMember(request);
    const { teamId, userId } = await context.params;
    requireTeamRole(session.userId, teamId, ["owner", "admin"]);
    const target = requireTeamRole(userId, teamId);
    if (target.role === "owner") throw new ApiError(409, "不能修改团队所有者", "OWNER_IMMUTABLE");
    const input = z
      .object({ role: z.enum(["admin", "member", "guest"]), expiresAt: z.iso.datetime().nullable().optional() })
      .parse(await jsonBody(request));
    db.prepare("UPDATE team_members SET role = ?, expires_at = ? WHERE team_id = ? AND user_id = ?").run(
      input.role,
      input.expiresAt || null,
      teamId,
      userId,
    );
    audit({ request, teamId, actorId: session.userId, action: "MEMBER_ROLE_UPDATE", targetType: "user", targetId: userId, detail: input });
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireMember(request);
    const { teamId, userId } = await context.params;
    requireTeamRole(session.userId, teamId, ["owner", "admin"]);
    const target = requireTeamRole(userId, teamId);
    if (target.role === "owner") throw new ApiError(409, "不能移除团队所有者", "OWNER_IMMUTABLE");
    db.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(teamId, userId);
    audit({ request, teamId, actorId: session.userId, action: "MEMBER_REMOVE", targetType: "user", targetId: userId });
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
