import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";
import { writablePlatformSettings } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

type Context = { params: Promise<{ teamId: string; userId: string }> };

export async function PATCH(request: NextRequest, context: Context) {
  try {
    await requireMember(request);
    const { teamId, userId } = await context.params;
    const input = z
      .object({ role: z.enum(["admin", "member", "guest"]), expiresAt: z.iso.datetime().nullable().optional() })
      .parse(await jsonBody(request));
    const session = await requireMember(request);
    enforceRateLimit(request, { namespace: "member-role-user", subject: `user:${session.userId}`, limit: 240, windowSeconds: 3_600, errorCode: "MEMBER_WRITE_RATE_LIMITED" });
    writablePlatformSettings();
    const operation = db.transaction(() => {
      requireTeamRole(session.userId, teamId, ["owner", "admin"]);
      const target = db
        .prepare("SELECT role, expires_at AS expiresAt FROM team_members WHERE team_id = ? AND user_id = ?")
        .get(teamId, userId) as { role: string; expiresAt: string | null } | undefined;
      if (!target) throw new ApiError(404, "团队成员不存在", "MEMBER_NOT_FOUND");
      if (target.role === "owner") throw new ApiError(409, "不能修改团队所有者", "OWNER_IMMUTABLE");
      const result = db
        .prepare(
          `UPDATE team_members SET role = ?, expires_at = ?
           WHERE team_id = ? AND user_id = ? AND role <> 'owner'`,
        )
        .run(input.role, input.expiresAt === undefined ? target.expiresAt : input.expiresAt, teamId, userId);
      if (result.changes !== 1) throw new ApiError(409, "成员角色已发生变化，请刷新后重试", "MEMBER_CHANGED");
      audit({ request, teamId, actorId: session.userId, action: "MEMBER_ROLE_UPDATE", targetType: "user", targetId: userId, detail: input });
    });
    operation.immediate();
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const session = await requireMember(request);
    const { teamId, userId } = await context.params;
    const operation = db.transaction(() => {
      requireTeamRole(session.userId, teamId, ["owner", "admin"]);
      const target = db
        .prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
        .get(teamId, userId) as { role: string } | undefined;
      if (!target) throw new ApiError(404, "团队成员不存在", "MEMBER_NOT_FOUND");
      if (target.role === "owner") throw new ApiError(409, "不能移除团队所有者", "OWNER_IMMUTABLE");
      const removed = db
        .prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ? AND role <> 'owner'")
        .run(teamId, userId);
      if (removed.changes !== 1) throw new ApiError(409, "团队所有权已发生变化，请刷新后重试", "MEMBER_CHANGED");
      audit({ request, teamId, actorId: session.userId, action: "MEMBER_REMOVE", targetType: "user", targetId: userId });
    });
    operation.immediate();
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
