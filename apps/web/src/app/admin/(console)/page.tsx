"use client";

import Link from "next/link";
import { ArrowRight, Boxes, Check, CircleAlert, Clock3, KeyRound, Share2, ShieldCheck, Users, UsersRound } from "lucide-react";
import { compactNumber, formatDate, useAdminData } from "@/components/admin/client";
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/admin/AdminUI";

type Overview = {
  metrics: {
    users: number; activeUsers: number; teams: number; activeTeams: number;
    items: number; activeItems: number; shares?: number; activeShares: number;
  };
  contentByKind: Array<{ kind: string; count: number }>;
  activityByDay: Array<{ date: string; count: number }>;
  topTeams: Array<{ id: string; name: string; status: string; memberCount: number; itemCount: number; lastActivityAt?: string | null; updatedAt?: string | null }>;
  recentAudit: Array<{ id: string; action: string; actorName: string | null; teamName: string | null; createdAt: string }>;
  alerts: Array<{ key: string; level?: "warning" | "info"; severity?: "info" | "warning" | "critical"; title: string; description?: string; detail?: string; href?: string }>;
  onboarding?: { wechatConfigured?: boolean; hasUsers?: boolean; hasTeams?: boolean; hasItems?: boolean };
};

const kindMeta: Record<string, { label: string; color: string }> = {
  totp: { label: "动态验证码", color: "lime" }, code: { label: "一次性验证码", color: "amber" },
  snippet: { label: "代码片段", color: "cyan" }, secret: { label: "临时密文", color: "violet" }, note: { label: "团队备注", color: "slate" },
};
const actionNames: Record<string, string> = {
  AUTH_LOGIN: "成员登录", ADMIN_LOGIN: "管理员登录", TEAM_CREATE: "创建团队", ITEM_CREATE: "创建内容",
  ITEM_UPDATE: "更新内容", ITEM_DELETE: "删除内容", ITEM_REVEAL: "查看内容", TOTP_VIEW: "查看动态码",
  SHARE_CREATE: "创建分享", SHARE_REDEEM: "领取分享", SHARE_REVOKE: "撤销分享", INVITE_CREATE: "创建邀请",
  INVITE_ACCEPT: "接受邀请", INVITE_REVOKE: "撤销邀请", MEMBER_ROLE_UPDATE: "调整成员角色", MEMBER_REMOVE: "移除成员",
  ADMIN_USER_STATUS_UPDATE: "调整用户状态", ADMIN_TEAM_STATUS_UPDATE: "调整团队状态",
};

export default function DashboardPage() {
  const { data, error, loading, reload } = useAdminData<Overview>("/api/admin/overview");
  if (loading) return <><PageHeader eyebrow="OPERATIONS" title="运营总览" description="掌握用户、团队、内容与安全状态。" /><LoadingState /></>;
  if (error || !data) return <><PageHeader eyebrow="OPERATIONS" title="运营总览" description="掌握用户、团队、内容与安全状态。" /><ErrorState message={error} onRetry={reload} /></>;
  const maxActivity = Math.max(1, ...data.activityByDay.map((point) => point.count));
  const totalKinds = Math.max(1, data.contentByKind.reduce((sum, item) => sum + item.count, 0));
  const onboarding = data.onboarding || { hasUsers: data.metrics.users > 0, hasTeams: data.metrics.teams > 0, hasItems: data.metrics.items > 0 };
  const setupSteps = [
    { label: "配置微信小程序凭据", done: Boolean(onboarding.wechatConfigured), href: "/admin/system" },
    { label: "首位成员完成微信登录", done: Boolean(onboarding.hasUsers), href: "/admin/users" },
    { label: "创建第一个协作团队", done: Boolean(onboarding.hasTeams), href: "/admin/teams" },
    { label: "保存第一项共享内容", done: Boolean(onboarding.hasItems), href: "/admin/content" },
  ];
  const setupComplete = setupSteps.filter((step) => step.done).length;

  return <>
    <PageHeader eyebrow="OPERATIONS" title="运营总览" description="掌握用户增长、团队活跃度、内容规模和风险事项。" actions={<><span className="admin-live"><i />生产环境在线</span><button className="admin-button secondary" type="button" onClick={reload}>刷新数据</button></>} />
    <section className="admin-metric-grid">
      <Metric icon={<Users size={19} />} label="用户总数" value={data.metrics.users} note={`${data.metrics.activeUsers} 位状态正常`} />
      <Metric icon={<UsersRound size={19} />} label="协作团队" value={data.metrics.teams} note={`${data.metrics.activeTeams} 个正常运行`} />
      <Metric icon={<Boxes size={19} />} label="内容资产" value={data.metrics.items} note={`${data.metrics.activeItems} 项可用`} accent />
      <Metric icon={<Share2 size={19} />} label="有效分享" value={data.metrics.activeShares} note={`${data.metrics.shares ?? data.metrics.activeShares} 条累计记录`} />
    </section>

    {setupComplete < setupSteps.length && <section className="admin-setup-card">
      <div className="admin-setup-copy"><span className="admin-card-icon"><KeyRound size={20} /></span><div><span className="admin-eyebrow">LAUNCH CHECKLIST</span><h2>完成上线初始化</h2><p>当前已完成 {setupComplete}/{setupSteps.length} 项，完成后小程序才具备完整业务数据。</p></div></div>
      <div className="admin-setup-list">{setupSteps.map((step) => <Link href={step.href} key={step.label} className={step.done ? "done" : ""}><span>{step.done ? <Check size={14} /> : <i />}</span>{step.label}<ArrowRight size={14} /></Link>)}</div>
    </section>}

    <div className="admin-dashboard-grid">
      <section className="admin-card admin-activity-card">
        <div className="admin-card-head"><div><span className="admin-eyebrow">LAST 14 DAYS</span><h2>操作活跃趋势</h2></div><small>审计事件数量</small></div>
        {data.activityByDay.length ? <div className="admin-bar-chart" aria-label="近 14 天操作活跃趋势">{data.activityByDay.map((point) => <div key={point.date} title={`${point.date}: ${point.count} 次`}><span>{point.count || ""}</span><i style={{ height: `${Math.max(5, point.count / maxActivity * 100)}%` }} /><small>{new Date(`${point.date}T00:00:00`).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</small></div>)}</div> : <EmptyState title="还没有活跃数据" description="成员开始使用小程序后，这里会形成趋势。" />}
      </section>
      <section className="admin-card">
        <div className="admin-card-head"><div><span className="admin-eyebrow">ASSET MIX</span><h2>内容构成</h2></div><Link href="/admin/content">查看全部 <ArrowRight size={13} /></Link></div>
        <div className="admin-kind-list">{Object.entries(kindMeta).map(([kind, meta]) => { const value = data.contentByKind.find((item) => item.kind === kind)?.count || 0; return <div key={kind}><span><i className={meta.color} />{meta.label}</span><b>{value}</b><em><i className={meta.color} style={{ width: `${value / totalKinds * 100}%` }} /></em></div>; })}</div>
      </section>
    </div>

    <div className="admin-dashboard-grid lower">
      <section className="admin-card">
        <div className="admin-card-head"><div><span className="admin-eyebrow">TEAM HEALTH</span><h2>活跃团队</h2></div><Link href="/admin/teams">团队管理 <ArrowRight size={13} /></Link></div>
        {data.topTeams.length ? <div className="admin-ranked-list">{data.topTeams.map((team, index) => <Link href="/admin/teams" key={team.id}><span className="admin-rank">{String(index + 1).padStart(2, "0")}</span><span className="admin-team-avatar">{team.name.slice(0, 1)}</span><span><b>{team.name}</b><small>{team.memberCount} 位成员 · 最近活动 {formatDate(team.lastActivityAt || team.updatedAt)}</small></span><strong>{team.itemCount}<small> 项内容</small></strong></Link>)}</div> : <EmptyState title="暂无团队" description="成员首次登录或管理员创建团队后会显示在这里。" action={<Link className="admin-button secondary" href="/admin/teams">前往团队管理</Link>} />}
      </section>
      <section className="admin-card">
        <div className="admin-card-head"><div><span className="admin-eyebrow">ACTION CENTER</span><h2>待处理事项</h2></div><CircleAlert size={18} /></div>
        {data.alerts.length ? <div className="admin-alert-list">{data.alerts.map((alert) => <Link href={alert.href || (alert.key === "wechat" || alert.key === "backup" ? "/admin/system" : alert.key === "first-team" ? "/admin/teams" : "/admin/users")} key={alert.key}><span className={alert.level || (alert.severity === "info" ? "info" : "warning")}><CircleAlert size={16} /></span><span><b>{alert.title}</b><small>{alert.description || alert.detail}</small></span><ArrowRight size={14} /></Link>)}</div> : <div className="admin-clear-state"><span><ShieldCheck size={22} /></span><b>当前没有待处理风险</b><small>系统状态和业务数据均处于正常范围。</small></div>}
      </section>
    </div>

    <section className="admin-card admin-audit-preview">
      <div className="admin-card-head"><div><span className="admin-eyebrow">SECURITY TRAIL</span><h2>最近操作</h2></div><Link href="/admin/audit">完整审计记录 <ArrowRight size={13} /></Link></div>
      {data.recentAudit.length ? <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>操作</th><th>操作者</th><th>团队</th><th>发生时间</th></tr></thead><tbody>{data.recentAudit.map((log) => <tr key={log.id}><td><span className="admin-event"><i />{actionNames[log.action] || log.action}</span></td><td>{log.actorName || "系统 / 匿名"}</td><td>{log.teamName || "—"}</td><td><span className="admin-time"><Clock3 size={13} />{formatDate(log.createdAt)}</span></td></tr>)}</tbody></table></div> : <EmptyState title="暂无审计记录" description="登录、查看、修改和分享等关键行为都会安全地记录在这里。" />}
    </section>
  </>;
}

function Metric({ icon, label, value, note, accent }: { icon: React.ReactNode; label: string; value: number; note: string; accent?: boolean }) {
  return <article className={`admin-metric${accent ? " accent" : ""}`}><div><span>{icon}</span><small>{label}</small></div><strong>{compactNumber(value)}</strong><p><StatusBadge status="active" label={note} /></p></article>;
}
