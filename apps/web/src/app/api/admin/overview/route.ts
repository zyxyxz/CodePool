import type { NextRequest } from "next/server";
import { adminFail, adminOk, getPlatformSettings, parseAuditDetail, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";

type CountRow = { value: number };

function count(sql: string, ...params: unknown[]) {
  return (db.prepare(sql).get(...params) as CountRow).value;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const settings = getPlatformSettings();
    const metrics = {
      users: count("SELECT COUNT(*) AS value FROM users"),
      activeUsers: count("SELECT COUNT(*) AS value FROM users WHERE status = 'active'"),
      disabledUsers: count("SELECT COUNT(*) AS value FROM users WHERE status = 'disabled'"),
      newUsers7d: count("SELECT COUNT(*) AS value FROM users WHERE datetime(created_at) >= datetime('now', '-7 days')"),
      teams: count("SELECT COUNT(*) AS value FROM teams"),
      activeTeams: count("SELECT COUNT(*) AS value FROM teams WHERE status = 'active'"),
      items: count("SELECT COUNT(*) AS value FROM vault_items"),
      activeItems: count(
        `SELECT COUNT(*) AS value FROM vault_items v JOIN teams t ON t.id = v.team_id
         WHERE v.status = 'active' AND t.status = 'active'
         AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)`,
      ),
      shares: count("SELECT COUNT(*) AS value FROM share_links"),
      activeShares: count(
        `SELECT COUNT(*) AS value FROM share_links s
         JOIN vault_items v ON v.id = s.item_id JOIN teams t ON t.id = v.team_id
         WHERE s.revoked_at IS NULL AND datetime(s.expires_at) > CURRENT_TIMESTAMP
         AND s.view_count < s.max_views AND v.status = 'active' AND t.status = 'active'
         AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)`,
      ),
      invites: count("SELECT COUNT(*) AS value FROM team_invites"),
      activeInvites: count(
        `SELECT COUNT(*) AS value FROM team_invites i JOIN teams t ON t.id = i.team_id
         WHERE i.revoked_at IS NULL AND i.used_at IS NULL AND t.status = 'active'
         AND datetime(i.expires_at) > CURRENT_TIMESTAMP`,
      ),
      auditEvents24h: count(
        "SELECT COUNT(*) AS value FROM audit_logs WHERE datetime(created_at) >= datetime('now', '-24 hours')",
      ),
      pendingDeletionRequests: count(
        "SELECT COUNT(*) AS value FROM account_deletion_requests WHERE status = 'pending'",
      ),
    };

    const kindCounts = db
      .prepare("SELECT kind, COUNT(*) AS count FROM vault_items GROUP BY kind")
      .all() as Array<{ kind: string; count: number }>;
    const kindMap = new Map(kindCounts.map((row) => [row.kind, row.count]));
    const contentByKind = ["totp", "code", "snippet", "secret", "note"].map((kind) => ({
      kind,
      count: kindMap.get(kind) || 0,
    }));

    const rawActivity = db
      .prepare(
        `SELECT date(created_at) AS date, COUNT(*) AS count
         FROM audit_logs
         WHERE datetime(created_at) >= datetime('now', '-13 days')
         GROUP BY date(created_at) ORDER BY date(created_at)`,
      )
      .all() as Array<{ date: string; count: number }>;
    const activityMap = new Map(rawActivity.map((row) => [row.date, row.count]));
    const activityByDay = Array.from({ length: 14 }, (_, index) => {
      const date = new Date();
      date.setUTCHours(0, 0, 0, 0);
      date.setUTCDate(date.getUTCDate() - (13 - index));
      const key = date.toISOString().slice(0, 10);
      return { date: key, count: activityMap.get(key) || 0 };
    });

    const topTeams = db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.status,
          u.nickname AS ownerName,
          (SELECT COUNT(*) FROM team_members tm JOIN users member_u ON member_u.id = tm.user_id
           WHERE tm.team_id = t.id AND member_u.status = 'active'
           AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)) AS memberCount,
          (SELECT COUNT(*) FROM vault_items v WHERE v.team_id = t.id) AS itemCount,
          t.updated_at AS updatedAt
         FROM teams t JOIN users u ON u.id = t.owner_id
         WHERE t.status = 'active'
         ORDER BY itemCount DESC, memberCount DESC, datetime(t.updated_at) DESC
         LIMIT 8`,
      )
      .all();

    const recentRows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
          a.detail, a.created_at AS createdAt,
          u.id AS actorId, u.nickname AS actorName,
          t.id AS teamId, t.name AS teamName
         FROM audit_logs a
         LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN teams t ON t.id = a.team_id
         ORDER BY datetime(a.created_at) DESC LIMIT 12`,
      )
      .all() as Array<Record<string, unknown> & { detail: string }>;
    const recentAudit = recentRows.map(({ detail, ...row }) => ({
      ...row,
      detail: parseAuditDetail(detail),
    }));

    const alerts: Array<{
      key: string;
      severity: "info" | "warning" | "critical";
      level: "info" | "warning" | "critical";
      title: string;
      detail: string;
      description: string;
      href: string;
    }> = [];
    const pushAlert = (
      key: string,
      severity: "info" | "warning" | "critical",
      title: string,
      detail: string,
      href: string,
    ) => alerts.push({ key, severity, level: severity, title, detail, description: detail, href });
    if (!process.env.WECHAT_APP_ID || !process.env.WECHAT_APP_SECRET) {
      pushAlert("wechat", "critical", "微信登录尚未配置", "请配置 WECHAT_APP_ID 与 WECHAT_APP_SECRET。", "/admin/system");
    }
    if (metrics.users === 0) {
      pushAlert("first-user", "info", "等待首个用户", "用户首次从小程序登录后会自动创建个人团队。", "/admin/users");
    }
    if (metrics.teams === 0) {
      pushAlert("first-team", "info", "尚无团队", "可在团队管理中为已有用户创建团队。", "/admin/teams");
    }
    if (settings.maintenanceMode) {
      pushAlert("maintenance", "warning", "维护模式已开启", "请确认客户端已正确展示维护提示。", "/admin/system");
    }
    if (metrics.pendingDeletionRequests > 0) {
      pushAlert(
        "account-deletion",
        "warning",
        "有待处理的账号注销申请",
        `当前有 ${metrics.pendingDeletionRequests} 条注销申请等待审核。`,
        "/admin/deletions",
      );
    }
    pushAlert("backup", "warning", "尚未接入自动备份", "当前为 SQLite 单实例，请为持久卷配置定期快照。", "/admin/system");

    return adminOk({
      metrics,
      contentByKind,
      activityByDay,
      topTeams,
      recentAudit,
      alerts,
      onboarding: {
        wechatConfigured: Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET),
        hasUsers: metrics.users > 0,
        hasTeams: metrics.teams > 0,
        hasItems: metrics.items > 0,
      },
    });
  } catch (error) {
    return adminFail(error);
  }
}
