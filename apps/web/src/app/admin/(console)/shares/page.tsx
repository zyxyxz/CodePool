"use client";

import { useMemo, useState } from "react";
import { Clock3, Link2Off, MailQuestion, Share2, TicketCheck, X } from "lucide-react";
import { adminRequest, formatDate, useAdminData, useClampedPage } from "@/components/admin/client";
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SearchField, StatusBadge } from "@/components/admin/AdminUI";

type Share = { id: string; itemTitle: string; itemKind: string; teamName: string; creatorName: string | null; status: string; viewCount: number; maxViews: number; expiresAt: string; createdAt: string };
type Invite = { id: string; teamName: string; role: string; creatorName: string | null; status: string; expiresAt: string; createdAt: string; usedAt: string | null };
type ListData<T> = { items: T[]; total: number; page: number; pageSize: number; totalPages: number; counts?: Record<string, number> };

export default function SharesPage() {
  const [tab, setTab] = useState<"shares" | "invites">("shares"); const [query, setQuery] = useState(""); const [status, setStatus] = useState("all"); const [page, setPage] = useState(1);
  const [revoke, setRevoke] = useState<{ id: string; label: string } | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  const url = useMemo(() => `/api/admin/${tab}?q=${encodeURIComponent(query)}&status=${status}&page=${page}&pageSize=20`, [tab, query, status, page]);
  const { data, error, loading, reload } = useAdminData<ListData<Share | Invite>>(url);
  useClampedPage(data, setPage);
  function switchTab(next: "shares" | "invites") { setTab(next); setPage(1); setQuery(""); setStatus("all"); }
  async function confirmRevoke() { if (!revoke) return; setBusy(true); try { await adminRequest(`/api/admin/${tab}/${revoke.id}`, { method: "DELETE" }); setNotice(tab === "shares" ? "分享链接已撤销" : "团队邀请已撤销"); setRevoke(null); reload(); } catch (reason) { setNotice(reason instanceof Error ? reason.message : "撤销失败"); } finally { setBusy(false); } }
  return <>
    <PageHeader eyebrow="ACCESS LINKS" title="分享与邀请" description="跟踪外部分享和入组邀请，及时撤销异常或不再需要的访问入口。" />
    {notice && <div className="admin-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}
    <div className="admin-tabs" role="tablist"><button role="tab" type="button" aria-selected={tab === "shares"} className={tab === "shares" ? "selected" : ""} onClick={() => switchTab("shares")}><Share2 size={16} />内容分享</button><button role="tab" type="button" aria-selected={tab === "invites"} className={tab === "invites" ? "selected" : ""} onClick={() => switchTab("invites")}><MailQuestion size={16} />团队邀请</button></div>
    <section className="admin-card admin-resource-card"><div className="admin-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={tab === "shares" ? "搜索内容、团队或创建者" : "搜索团队或创建者"} /><label className="admin-select-label compact"><span>状态</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">全部状态</option><option value="active">有效</option><option value="used">已使用</option><option value="expired">已过期</option>{tab === "shares" && <option value="unavailable">关联资源不可用</option>}<option value="revoked">已撤销</option></select></label><span className="admin-result-count">共 {data?.total || 0} 条</span></div>
      {loading ? <LoadingState label={tab === "shares" ? "正在加载分享记录" : "正在加载邀请记录"} /> : error || !data ? <ErrorState message={error} onRetry={reload} /> : !data.items.length ? <EmptyState title={tab === "shares" ? "暂无分享记录" : "暂无邀请记录"} description={tab === "shares" ? "成员从内容详情创建外部分享后会显示在这里。" : "团队管理员创建成员邀请后会显示在这里。"} /> : tab === "shares" ? <ShareTable data={data as ListData<Share>} onRevoke={(item) => setRevoke({ id: item.id, label: item.itemTitle })} /> : <InviteTable data={data as ListData<Invite>} onRevoke={(item) => setRevoke({ id: item.id, label: item.teamName })} />}
      {data && <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </section>
    <ConfirmDialog open={Boolean(revoke)} title={tab === "shares" ? "撤销这条分享？" : "撤销这份邀请？"} description={tab === "shares" ? `撤销后，“${revoke?.label}”对应的分享链接会立即失效。` : `撤销后，“${revoke?.label}”的这份邀请将无法继续使用。`} confirmLabel="确认撤销" danger busy={busy} onCancel={() => setRevoke(null)} onConfirm={confirmRevoke} />
  </>;
}

function ShareTable({ data, onRevoke }: { data: ListData<Share>; onRevoke: (item: Share) => void }) { return <div className="admin-table-wrap"><table className="admin-table resource"><thead><tr><th>分享内容</th><th>团队</th><th>创建者</th><th>领取次数</th><th>到期时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><div className="admin-entity"><span className="admin-kind-icon share"><Share2 size={16} /></span><span><b>{item.itemTitle}</b><small>创建于 {formatDate(item.createdAt)}</small></span></div></td><td>{item.teamName}</td><td>{item.creatorName || "—"}</td><td>{item.viewCount} / {item.maxViews}</td><td><span className="admin-time"><Clock3 size={13} />{formatDate(item.expiresAt)}</span></td><td><StatusBadge status={item.status} label={item.status === "active" ? "有效" : undefined} /></td><td>{item.status === "active" ? <button className="admin-row-action danger" type="button" onClick={() => onRevoke(item)}><Link2Off size={14} />撤销</button> : "—"}</td></tr>)}</tbody></table></div>; }
function InviteTable({ data, onRevoke }: { data: ListData<Invite>; onRevoke: (item: Invite) => void }) { return <div className="admin-table-wrap"><table className="admin-table resource"><thead><tr><th>邀请团队</th><th>邀请角色</th><th>创建者</th><th>创建时间</th><th>到期时间</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.items.map((item) => <tr key={item.id}><td><div className="admin-entity"><span className="admin-kind-icon invite"><TicketCheck size={16} /></span><span><b>{item.teamName}</b><small>{item.usedAt ? `使用于 ${formatDate(item.usedAt)}` : "尚未领取"}</small></span></div></td><td><span className={`admin-role ${item.role}`}>{item.role}</span></td><td>{item.creatorName || "—"}</td><td>{formatDate(item.createdAt)}</td><td>{formatDate(item.expiresAt)}</td><td><StatusBadge status={item.status} label={item.status === "active" ? "有效" : undefined} /></td><td>{item.status === "active" ? <button className="admin-row-action danger" type="button" onClick={() => onRevoke(item)}><Link2Off size={14} />撤销</button> : "—"}</td></tr>)}</tbody></table></div>; }
