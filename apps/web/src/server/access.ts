import "server-only";

import { db } from "./db";
import { ApiError } from "./api";

export type Role = "owner" | "admin" | "member" | "guest";

export function requireTeamRole(userId: string, teamId: string, allowed?: Role[]) {
  const membership = db
    .prepare(
      `SELECT role, expires_at AS expiresAt FROM team_members
       WHERE team_id = ? AND user_id = ?`,
    )
    .get(teamId, userId) as { role: Role; expiresAt: string | null } | undefined;

  if (!membership || (membership.expiresAt && new Date(membership.expiresAt) <= new Date())) {
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
       WHERE v.id = ?
       AND (tm.expires_at IS NULL OR tm.expires_at > CURRENT_TIMESTAMP)
       AND (v.expires_at IS NULL OR v.expires_at > CURRENT_TIMESTAMP)`,
    )
    .get(userId, itemId) as Record<string, unknown> | undefined;
  if (!item) throw new ApiError(404, "内容不存在或无权访问", "ITEM_NOT_FOUND");
  return item;
}
