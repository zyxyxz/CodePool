import "server-only";

import { ApiError } from "./api";
import { getPlatformSettings } from "./admin";
import { db } from "./db";

const MAX_OWNED_TEAMS_PER_USER = 10;
const MAX_ACTIVE_SHARES_PER_ITEM = 25;
const MAX_ACTIVE_SHARES_PER_TEAM = 2_000;
const MAX_ACTIVE_INVITES_PER_TEAM = 50;

function ensureWritable() {
  const settings = getPlatformSettings();
  if (settings.maintenanceMode) {
    throw new ApiError(503, "系统维护中，暂时无法进行写入操作", "MAINTENANCE_MODE", {
      "Retry-After": "300",
    });
  }
  return settings;
}

function scalarCount(sql: string, ...params: unknown[]) {
  const row = db.prepare(sql).get(...params) as { count: number };
  return row.count;
}

export function assertCanCreateTeam(userId: string) {
  const settings = ensureWritable();
  if (!settings.allowNewTeams) {
    throw new ApiError(403, "运营后台已暂停创建团队", "TEAM_CREATION_DISABLED");
  }
  const ownedTeams = scalarCount(
    "SELECT COUNT(*) AS count FROM teams WHERE owner_id = ? AND status = 'active'",
    userId,
  );
  if (ownedTeams >= MAX_OWNED_TEAMS_PER_USER) {
    throw new ApiError(409, `每个账号最多创建 ${MAX_OWNED_TEAMS_PER_USER} 个团队`, "TEAM_QUOTA_EXCEEDED");
  }
  return settings;
}

export function assertCanCreateItem(teamId: string) {
  const settings = ensureWritable();
  const itemCount = scalarCount(
    "SELECT COUNT(*) AS count FROM vault_items WHERE team_id = ? AND status = 'active'",
    teamId,
  );
  if (itemCount >= settings.maxItemsPerTeam) {
    throw new ApiError(409, `团队内容数量已达到上限（${settings.maxItemsPerTeam}）`, "ITEM_QUOTA_EXCEEDED");
  }
  return settings;
}

export function assertCanCreateShare(itemId: string) {
  const settings = ensureWritable();
  if (!settings.allowPublicShares) {
    throw new ApiError(403, "运营后台已暂停公开分享", "PUBLIC_SHARES_DISABLED");
  }
  const activeShares = scalarCount(
    `SELECT COUNT(*) AS count FROM share_links
     WHERE item_id = ? AND revoked_at IS NULL
     AND datetime(expires_at) > CURRENT_TIMESTAMP
     AND view_count < max_views`,
    itemId,
  );
  if (activeShares >= MAX_ACTIVE_SHARES_PER_ITEM) {
    throw new ApiError(
      409,
      `每条内容最多保留 ${MAX_ACTIVE_SHARES_PER_ITEM} 个有效分享`,
      "SHARE_QUOTA_EXCEEDED",
    );
  }
  const teamActiveShares = scalarCount(
    `SELECT COUNT(*) AS count FROM share_links s
     JOIN vault_items v ON v.id = s.item_id
     WHERE v.team_id = (SELECT team_id FROM vault_items WHERE id = ?)
     AND s.revoked_at IS NULL
     AND datetime(s.expires_at) > CURRENT_TIMESTAMP
     AND s.view_count < s.max_views`,
    itemId,
  );
  if (teamActiveShares >= MAX_ACTIVE_SHARES_PER_TEAM) {
    throw new ApiError(
      409,
      `每个团队最多保留 ${MAX_ACTIVE_SHARES_PER_TEAM} 个有效分享`,
      "TEAM_SHARE_QUOTA_EXCEEDED",
    );
  }
  return settings;
}

export function assertCanCreateInvite(teamId: string) {
  const settings = ensureWritable();
  if (!settings.allowInvites) {
    throw new ApiError(403, "运营后台已暂停团队邀请", "INVITES_DISABLED");
  }
  const memberCount = scalarCount(
    `SELECT COUNT(*) AS count FROM team_members tm
     JOIN users u ON u.id = tm.user_id
     WHERE tm.team_id = ? AND u.status = 'active'
     AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)`,
    teamId,
  );
  if (memberCount >= settings.maxMembersPerTeam) {
    throw new ApiError(
      409,
      `团队成员数已达到上限（${settings.maxMembersPerTeam}）`,
      "MEMBER_QUOTA_EXCEEDED",
    );
  }
  const activeInvites = scalarCount(
    `SELECT COUNT(*) AS count FROM team_invites
     WHERE team_id = ? AND used_at IS NULL AND revoked_at IS NULL
     AND datetime(expires_at) > CURRENT_TIMESTAMP`,
    teamId,
  );
  if (activeInvites >= MAX_ACTIVE_INVITES_PER_TEAM) {
    throw new ApiError(
      409,
      `每个团队最多保留 ${MAX_ACTIVE_INVITES_PER_TEAM} 个有效邀请`,
      "INVITE_QUOTA_EXCEEDED",
    );
  }
  return settings;
}

export function inviteAcceptanceSettings() {
  const settings = ensureWritable();
  if (!settings.allowInvites) {
    throw new ApiError(403, "运营后台已暂停团队邀请", "INVITES_DISABLED");
  }
  return settings;
}

export function writablePlatformSettings() {
  return ensureWritable();
}
