import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAudit, adminFail, adminOk, requireAdminRequest } from '@/server/admin';
import { ApiError, jsonBody } from '@/server/api';
import { db } from '@/server/db';

export async function PATCH(request: NextRequest, context: { params: Promise<{ teamId: string; userId: string }> }) {
  try {
    const session = await requireAdminRequest(request, true);
    const { teamId, userId } = await context.params;
    z.uuid().parse(teamId); z.uuid().parse(userId);
    const input = z.object({ role: z.enum(['admin', 'member', 'guest']) }).strict().parse(await jsonBody(request));
    db.transaction(() => {
      const member = db.prepare(`SELECT tm.role, u.status, t.owner_id AS ownerId FROM team_members tm
        JOIN users u ON u.id = tm.user_id JOIN teams t ON t.id = tm.team_id WHERE tm.team_id = ? AND tm.user_id = ?`).get(teamId, userId) as { role: string; status: string; ownerId: string } | undefined;
      if (!member) throw new ApiError(404, '团队成员不存在', 'MEMBER_NOT_FOUND');
      if (member.role === 'owner' || member.ownerId === userId) throw new ApiError(409, '请通过转移所有权调整团队所有者', 'OWNER_IMMUTABLE');
      if (member.status !== 'active') throw new ApiError(409, '无法调整已停用或注销的成员权限', 'MEMBER_DISABLED');
      db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?').run(input.role, teamId, userId);
      adminAudit(request, session, { teamId, action: 'ADMIN_MEMBER_ROLE_UPDATE', targetType: 'user', targetId: userId, detail: { previousRole: member.role, role: input.role } });
    }).immediate();
    return adminOk({ success: true });
  } catch (error) { return adminFail(error); }
}
