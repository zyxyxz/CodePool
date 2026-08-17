"use client";

import { useMemo, useState } from "react";
import { Clock3, Download, Fingerprint, ShieldCheck } from "lucide-react";
import { formatDate, useAdminData, useClampedPage } from "@/components/admin/client";
import { EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SearchField } from "@/components/admin/AdminUI";

type AuditLog = { id: string; action: string; targetType: string; targetId: string | null; actorName: string | null; teamName: string | null; detail: Record<string, unknown>; createdAt: string };
type ListData = { items: AuditLog[]; total: number; page: number; pageSize: number; totalPages: number; actions?: Array<{ action: string; count: number }> };
const names: Record<string, string> = {
  AUTH_LOGIN: "成员登录", ADMIN_LOGIN: "管理员登录", ADMIN_LOGIN_FAILED: "管理员登录失败", TEAM_CREATE: "创建团队",
  TEAM_UPDATE: "更新团队", TOTP_CREATE: "创建动态码", TOTP_VIEW: "查看动态码", ITEM_CREATE: "创建内容", ITEM_UPDATE: "更新内容",
  ITEM_DELETE: "删除内容", ITEM_REVEAL: "查看内容", SHARE_CREATE: "创建分享", SHARE_REDEEM: "领取分享", SHARE_REVOKE: "撤销分享",
  INVITE_CREATE: "创建邀请", INVITE_ACCEPT: "接受邀请", INVITE_REVOKE: "撤销邀请", MEMBER_ROLE_UPDATE: "调整角色", MEMBER_REMOVE: "移除成员",
  ADMIN_USER_STATUS_UPDATE: "运营调整用户状态", ADMIN_TEAM_STATUS_UPDATE: "运营调整团队状态", ADMIN_ITEM_STATUS_UPDATE: "运营调整内容状态",
  ADMIN_SETTINGS_UPDATE: "更新运营设置",
};

export default function AuditPage() {
  const [query, setQuery] = useState(""); const [action, setAction] = useState("all"); const [range, setRange] = useState("30d"); const [page, setPage] = useState(1);
  const url = useMemo(() => `/api/admin/audit?q=${encodeURIComponent(query)}&action=${action}&range=${range}&page=${page}&pageSize=30`, [query, action, range, page]);
  const { data, error, loading, reload } = useAdminData<ListData>(url);
  useClampedPage(data, setPage);
  function exportCsv() {
    if (!data?.items.length) return;
    const escape = (value: unknown) => {
      const raw = String(value ?? "");
      const safe = /^\s*[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [["时间","操作","操作者","团队","目标类型","目标 ID"], ...data.items.map((log) => [formatDate(log.createdAt), names[log.action] || log.action, log.actorName || "系统 / 匿名", log.teamName || "", log.targetType, log.targetId || ""])];
    const blob = new Blob(["\ufeff" + rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `codepool-audit-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  }
  return <>
    <PageHeader eyebrow="SECURITY TRAIL" title="安全审计" description="追踪关键访问和管理操作，敏感正文、令牌与原始 IP 永不进入日志。" actions={<button className="admin-button secondary" type="button" onClick={exportCsv} disabled={!data?.items.length}><Download size={16} />导出当前页</button>} />
    <section className="admin-card admin-resource-card"><div className="admin-toolbar multi"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索操作者、团队或目标 ID" /><label className="admin-select-label"><span>操作类型</span><select value={action} onChange={(event) => { setAction(event.target.value); setPage(1); }}><option value="all">全部操作</option>{(data?.actions || []).map((item) => <option value={item.action} key={item.action}>{names[item.action] || item.action} ({item.count})</option>)}</select></label><label className="admin-select-label"><span>时间范围</span><select value={range} onChange={(event) => { setRange(event.target.value); setPage(1); }}><option value="24h">最近 24 小时</option><option value="7d">最近 7 天</option><option value="30d">最近 30 天</option><option value="90d">最近 90 天</option><option value="all">全部时间</option></select></label><span className="admin-result-count">{data?.total || 0} 条记录</span></div>
      {loading ? <LoadingState label="正在加载审计记录" /> : error || !data ? <ErrorState message={error} onRetry={reload} /> : !data.items.length ? <EmptyState title="没有匹配的审计记录" description="关键登录、查看、创建、修改、删除和分享操作会显示在这里。" /> : <><div className="admin-audit-timeline">{data.items.map((log) => <article key={log.id}><span className="admin-timeline-dot"><ShieldCheck size={15} /></span><div className="admin-audit-main"><div><b>{names[log.action] || log.action}</b><span className="admin-audit-code">{log.action}</span></div><p><strong>{log.actorName || "系统 / 匿名访问"}</strong>{log.teamName ? <> 在 <strong>{log.teamName}</strong></> : null} · 操作对象 {log.targetType}{log.targetId ? ` / ${log.targetId.slice(0, 8)}` : ""}</p>{Object.keys(log.detail || {}).length > 0 && <details><summary>查看操作上下文</summary><pre>{JSON.stringify(log.detail, null, 2)}</pre></details>}</div><time><Clock3 size={13} />{formatDate(log.createdAt)}</time></article>)}</div><Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} /></>}
    </section>
    <section className="admin-info-banner"><Fingerprint size={18} /><div><b>隐私化审计</b><p>服务端仅保存 IP 的不可逆短摘要用于风险关联，不保存原始 IP；导出数据同样不会包含该摘要。</p></div></section>
  </>;
}
