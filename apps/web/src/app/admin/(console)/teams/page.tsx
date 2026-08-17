"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Building2, ChevronRight, CirclePlus, MoreHorizontal, Shield, Users, X } from "lucide-react";
import { adminRequest, formatDate, useAdminData, useClampedPage } from "@/components/admin/client";
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Pagination, SearchField, StatusBadge } from "@/components/admin/AdminUI";

type Team = { id: string; name: string; slug: string; status: string; ownerId: string; ownerName: string; memberCount: number; itemCount: number; activeShareCount?: number; createdAt: string; updatedAt: string; lastActivityAt?: string | null; canRestore?: number; eligibleOwnerCount?: number };
type TeamDetail = { team: Team; members: Array<{ id?: string; userId?: string; nickname: string; role: string; status: string; joinedAt: string; expiresAt: string | null; eligibleOwner: number }>; contentByKind: Array<{ kind: string; count: number }>; recentAudit: Array<{ id: string; action: string; actorName: string | null; createdAt: string }> };
type ListData = { items: Team[]; total: number; page: number; pageSize: number; totalPages: number };
type UserOption = { id: string; nickname: string; status: string };

export default function TeamsPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Team | null>(null);
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirm, setConfirm] = useState<{ team: Team; next: "active" | "disabled" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownersError, setOwnersError] = useState("");
  const [ownerLoadVersion, setOwnerLoadVersion] = useState(0);
  const [transferOwnerId, setTransferOwnerId] = useState("");
  const detailRequest = useRef(0);
  const url = useMemo(() => `/api/admin/teams?q=${encodeURIComponent(query)}&status=${status}&page=${page}&pageSize=20`, [query, status, page]);
  const { data, error, loading, reload } = useAdminData<ListData>(url);
  useClampedPage(data, setPage);

  useEffect(() => {
    if (!createOpen) return;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      setOwnersLoading(true);
      setOwnersError("");
      adminRequest<{ items: UserOption[] }>(`/api/admin/users?status=active&q=${encodeURIComponent(ownerQuery)}&pageSize=20`, { signal: controller.signal })
        .then((result) => setUsers(result.items))
        .catch((reason: unknown) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          setUsers([]);
          setOwnersError(reason instanceof Error ? reason.message : "可选用户加载失败");
        })
        .finally(() => { if (!controller.signal.aborted) setOwnersLoading(false); });
    }, 250);
    return () => { globalThis.clearTimeout(timer); controller.abort(); };
  }, [createOpen, ownerQuery, ownerLoadVersion]);

  async function openTeam(team: Team) {
    const requestId = ++detailRequest.current;
    setSelected(team);
    setDetail(null);
    setTransferOwnerId("");
    setDetailLoading(true);
    try {
      const result = await adminRequest<TeamDetail>(`/api/admin/teams/${team.id}`);
      if (detailRequest.current === requestId) setDetail(result);
    } catch (reason) {
      if (detailRequest.current === requestId) setNotice(reason instanceof Error ? reason.message : "团队详情加载失败");
    } finally {
      if (detailRequest.current === requestId) setDetailLoading(false);
    }
  }

  async function changeStatus() {
    if (!confirm) return;
    setBusy(true);
    try {
      await adminRequest(`/api/admin/teams/${confirm.team.id}`, { method: "PATCH", body: JSON.stringify({ status: confirm.next, reason: "运营后台人工调整" }) });
      setNotice(`“${confirm.team.name}”状态已更新`); setSelected(null); setConfirm(null); reload();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "操作失败"); } finally { setBusy(false); }
  }

  function openCreate() {
    setOwnerQuery("");
    setUsers([]);
    setOwnersError("");
    setCreateOpen(true);
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await adminRequest("/api/admin/teams", { method: "POST", body: JSON.stringify({ name: form.get("name"), ownerId: form.get("ownerId") }) });
      setCreateOpen(false); setNotice("团队创建成功"); reload();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "创建失败"); } finally { setBusy(false); }
  }

  async function transferOwnership() {
    if (!selected || !transferOwnerId) return;
    setBusy(true);
    try {
      await adminRequest(`/api/admin/teams/${selected.id}`, { method: "PATCH", body: JSON.stringify({ ownerId: transferOwnerId }) });
      setNotice("团队所有权已转移，原所有者已调整为管理员");
      const refreshed = { ...selected, ownerId: transferOwnerId };
      openTeam(refreshed);
      reload();
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : "所有权转移失败"); } finally { setBusy(false); }
  }

  return <>
    <PageHeader eyebrow="WORKSPACES" title="团队管理" description="管理协作空间、所有者、成员规模和团队运行状态。" actions={<button className="admin-button primary" type="button" onClick={openCreate}><CirclePlus size={16} />新建团队</button>} />
    {notice && <div className="admin-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}
    <section className="admin-card admin-resource-card">
      <div className="admin-toolbar"><SearchField value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索团队名称或标识" /><div className="admin-segmented">{[["all","全部"],["active","正常"],["disabled","已停用"]].map(([value,label]) => <button type="button" className={status === value ? "selected" : ""} onClick={() => { setStatus(value); setPage(1); }} key={value}>{label}</button>)}</div><span className="admin-result-count">共 {data?.total || 0} 个团队</span></div>
      {loading ? <LoadingState label="正在加载团队" /> : error || !data ? <ErrorState message={error} onRetry={reload} /> : !data.items.length ? <EmptyState title={query ? "没有匹配的团队" : "还没有协作团队"} description={query ? "请调整搜索词或筛选条件。" : "成员完成首次登录后即可创建团队；也可由运营人员指定所有者创建。"} action={!query ? <button className="admin-button secondary" type="button" onClick={openCreate}>新建第一个团队</button> : undefined} /> : <>
        <div className="admin-table-wrap"><table className="admin-table resource"><thead><tr><th>团队</th><th>所有者</th><th>成员</th><th>内容</th><th>最近更新</th><th>状态</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{data.items.map((team) => <tr key={team.id}><td><button className="admin-entity" type="button" onClick={() => openTeam(team)}><span className="admin-team-avatar"><Building2 size={16} /></span><span><b>{team.name}</b><small>{team.slug}</small></span></button></td><td>{team.ownerName || "—"}</td><td><span className="admin-inline-count"><Users size={14} />{team.memberCount}</span></td><td>{team.itemCount} 项</td><td>{formatDate(team.updatedAt)}</td><td><StatusBadge status={team.status} /></td><td><button className="admin-icon-button" type="button" onClick={() => openTeam(team)} aria-label={`管理 ${team.name}`}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
        <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
      </>}
    </section>

    {selected && <div className="admin-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) { detailRequest.current += 1; setSelected(null); setDetail(null); } }}><aside className="admin-drawer" aria-label={`${selected.name} 团队详情`}><header><div><span className="admin-team-avatar large">{selected.name.slice(0, 1)}</span><div><small>团队详情</small><h2>{selected.name}</h2></div></div><button type="button" onClick={() => { detailRequest.current += 1; setSelected(null); setDetail(null); }} aria-label="关闭"><X size={19} /></button></header>{detailLoading ? <LoadingState label="加载团队详情" /> : detail ? <div className="admin-drawer-body">
      <section className="admin-detail-summary"><div><span>运行状态</span><StatusBadge status={detail.team.status} /></div><div><span>团队所有者</span><b>{detail.team.ownerName}</b></div><div><span>创建时间</span><b>{formatDate(detail.team.createdAt)}</b></div><div><span>内容 / 成员</span><b>{detail.team.itemCount} / {detail.team.memberCount}</b></div></section>
      <section><div className="admin-section-title"><h3>成员与角色</h3><span>{detail.members.length} 人</span></div><div className="admin-member-list">{detail.members.map((member) => <div key={member.userId || member.id}><span className="admin-user-avatar">{member.nickname.slice(0,1)}</span><span><b>{member.nickname}</b><small>加入于 {formatDate(member.joinedAt, false)}</small></span><span className={`admin-role ${member.role}`}>{member.role}</span></div>)}</div></section>
      <section><div className="admin-section-title"><h3>转移所有权</h3><span>仅可选择正常且未过期的现有成员</span></div><div className="admin-owner-transfer"><select value={transferOwnerId} onChange={(event) => setTransferOwnerId(event.target.value)}><option value="">选择新的团队所有者</option>{detail.members.filter((member) => (member.userId || member.id) !== detail.team.ownerId && Boolean(member.eligibleOwner)).map((member) => <option key={member.userId || member.id} value={member.userId || member.id}>{member.nickname} · {member.role}</option>)}</select><button className="admin-button secondary" type="button" disabled={!transferOwnerId || busy} onClick={transferOwnership}>确认转移</button></div></section>
      <section><div className="admin-section-title"><h3>运营操作</h3><span>变更会写入审计日志</span></div><div className="admin-action-grid">{detail.team.status !== "active" && <button type="button" disabled={!detail.team.canRestore} onClick={() => setConfirm({ team: detail.team, next: "active" })}><Shield size={16} /><span><b>恢复团队</b><small>{detail.team.canRestore ? "允许成员继续访问" : detail.team.eligibleOwnerCount ? "请先转移给正常成员" : "所有者已注销，团队保持归档"}</small></span></button>}{detail.team.status === "active" && <button className="danger" type="button" onClick={() => setConfirm({ team: detail.team, next: "disabled" })}><MoreHorizontal size={16} /><span><b>停用团队</b><small>撤销分享并阻止访问</small></span></button>}</div></section>
    </div> : <ErrorState message="团队详情不可用" onRetry={() => openTeam(selected)} />}</aside></div>}

    {createOpen && <div className="admin-modal-layer"><form className="admin-modal admin-form-modal" onSubmit={createTeam}><span className="admin-card-icon"><Building2 size={20} /></span><h2>新建协作团队</h2><p>指定一位已完成微信登录的正常用户作为团队所有者。</p><label>团队名称<input name="name" minLength={2} maxLength={48} required autoFocus placeholder="例如：产品研发组" /></label><label>搜索所有者<input value={ownerQuery} maxLength={120} onChange={(event) => setOwnerQuery(event.target.value)} placeholder="输入用户昵称；结果最多 20 条" /></label><label>团队所有者<select name="ownerId" required defaultValue="" disabled={ownersLoading || Boolean(ownersError)}><option value="" disabled>{ownersLoading ? "正在加载用户…" : "请选择用户"}</option>{users.map((user) => <option key={user.id} value={user.id}>{user.nickname}</option>)}</select></label>{ownersError ? <div className="admin-inline-warning">{ownersError} <button type="button" onClick={() => setOwnerLoadVersion((value) => value + 1)}>重试</button></div> : !ownersLoading && !users.length ? <div className="admin-inline-warning">没有匹配的正常用户，请调整搜索词或先让成员登录。</div> : null}<div><button type="button" className="admin-button secondary" onClick={() => setCreateOpen(false)}>取消</button><button type="submit" className="admin-button primary" disabled={busy || ownersLoading || Boolean(ownersError) || !users.length}>{busy ? "创建中…" : "创建团队"}</button></div></form></div>}
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.next === "active" ? "恢复团队访问？" : "停用这个团队？"} description={confirm?.next === "active" ? "恢复后，团队成员可以继续访问团队内内容。" : "团队成员将无法继续访问，所有未失效的分享和邀请会被撤销，但加密数据会保留。"} confirmLabel={confirm?.next === "active" ? "确认恢复" : "确认停用"} danger={confirm?.next !== "active"} busy={busy} onCancel={() => setConfirm(null)} onConfirm={changeStatus} />
  </>;
}
