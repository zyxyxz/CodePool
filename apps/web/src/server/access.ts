import "server-only";

import { db } from "./db";
import { ApiError } from "./api";

export type Role = "owner" | "admin" | "member" | "guest";

export function requireTeamRole(userId: string, teamId: string, allowed?: Role[]) {
  const membership = db
    .prepare(
      `SELECT tm.role, tm.expires_at AS expiresAt
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = ? AND tm.user_id = ?
       AND t.status = 'active' AND u.status = 'active'`,
    )
    .get(teamId, userId) as { role: Role; expiresAt: string | null } | undefined;

  if (!membership || (membership.expiresAt && new Date(membership.expiresAt).getTime() <= Date.now())) {
    throw new ApiError(403, "你不在这个团队中", "FORBIDDEN");
  }
  if (allowed && !allowed.includes(membership.role)) {
    throw new ApiError(403, "当前角色没有此操作权限", "FORBIDDEN");
  }
  return membership;
}

export function getItemForUser(userId: string, itemId: string) {
  const item = db
    .prepare(
      `SELECT v.*, tm.role FROM vault_items v
       JOIN team_members tm ON tm.team_id = v.team_id AND tm.user_id = ?
       JOIN teams t ON t.id = v.team_id
       WHERE v.id = ?
       AND v.status = 'active'
       AND t.status = 'active'
       AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
       AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)`,
    )
    .get(userId, itemId) as Record<string, unknown> | undefined;
  if (!item) throw new ApiError(404, "内容不存在或无权访问", "ITEM_NOT_FOUND");
  return item;
}
