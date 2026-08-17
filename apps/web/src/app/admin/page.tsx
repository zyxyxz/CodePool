import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminSession } from "@/server/auth";
import { db } from "@/server/db";

type Count = { value: number };
type RecentLog = { id: string; action: string; targetType: string; actorName: string | null; teamName: string | null; createdAt: string };
type TeamRow = { id: string; name: string; slug: string; ownerName: string; memberCount: number; itemCount: number; createdAt: string };

const actionNames: Record<string, string> = {
  AUTH_LOGIN: "用户登录", TEAM_CREATE: "创建团队", TOTP_CREATE: "添加动态码",
  TOTP_VIEW: "查看动态码", ITEM_CREATE: "添加内容", ITEM_REVEAL: "查看内容",
  SHARE_CREATE: "创建分享", SHARE_REDEEM: "领取分享", INVITE_CREATE: "创建邀请",
  INVITE_ACCEPT: "接受邀请", MEMBER_ROLE_UPDATE: "修改角色", MEMBER_REMOVE: "移除成员",
};

function count(table: string) {
  return (db.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as Count).value;
}

export default async function AdminPage() {
  if (!(await getAdminSession())) redirect("/admin/login");
  const stats = {
    users: count("users"), teams: count("teams"), items: count("vault_items"), shares: count("share_links"),
  };
  const kindRows = db.prepare("SELECT kind, COUNT(*) AS value FROM vault_items GROUP BY kind").all() as Array<{ kind: string; value: number }>;
  const kinds = Object.fromEntries(kindRows.map((row) => [row.kind, row.value]));
  const recent = db.prepare(
    `SELECT a.id, a.action, a.target_type AS targetType, u.nickname AS actorName,
     t.name AS teamName, a.created_at AS createdAt
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN teams t ON t.id = a.team_id
     ORDER BY a.created_at DESC LIMIT 12`,
  ).all() as RecentLog[];
  const teams = db.prepare(
    `SELECT t.id, t.name, t.slug, u.nickname AS ownerName, t.created_at AS createdAt,
     (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS memberCount,
     (SELECT COUNT(*) FROM vault_items v WHERE v.team_id = t.id) AS itemCount
     FROM teams t JOIN users u ON u.id = t.owner_id ORDER BY t.updated_at DESC LIMIT 8`,
  ).all() as TeamRow[];

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <Link href="/" className="brand"><span className="brand-mark">C</span><span>CodePool</span></Link>
        <nav><a className="selected" href="#overview"><i>⌁</i> 总览</a><a href="#teams"><i>◫</i> 团队</a><a href="#contents"><i>⌘</i> 内容池</a><a href="#audit"><i>↺</i> 安全审计</a></nav>
        <div className="sidebar-foot"><span><i className="status-dot" /> 系统运行正常</span><form action="/api/admin/logout" method="post"><button>退出登录</button></form></div>
      </aside>
      <section className="admin-main">
        <header><div><span className="kicker">CONTROL CENTER</span><h1>早上好，管理员</h1><p>这是 CodePool 当前的运行概览。</p></div><div className="header-date">{new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date())}<b>LIVE</b></div></header>
        <section className="stat-grid" id="overview">
          <article><span>用户</span><strong>{stats.users}</strong><small>微信成员总数</small></article>
          <article><span>团队池</span><strong>{stats.teams}</strong><small>正在协作的空间</small></article>
          <article className="accent"><span>内容项</span><strong>{stats.items}</strong><small>{kinds.totp || 0} 个动态验证码</small></article>
          <article><span>分享链接</span><strong>{stats.shares}</strong><small>含失效与已领取</small></article>
        </section>
        <div className="admin-columns">
          <section className="panel" id="contents"><div className="panel-title"><div><span>内容构成</span><h2>池内资产</h2></div><small>{stats.items} TOTAL</small></div>
            <div className="kind-bars">
              {[['totp','动态验证码','#9dfb70'],['snippet','代码片段','#64c7ff'],['code','一次性验证码','#ffcf5c'],['secret','密文','#bd92ff'],['note','备注','#8b95a7']].map(([key,label,color]) => { const value = kinds[key] || 0; const percent = stats.items ? Math.max(5, value / stats.items * 100) : 0; return <div key={key}><span>{label}<b>{value}</b></span><i><em style={{ width: `${percent}%`, background: color }} /></i></div> })}
            </div>
          </section>
          <section className="panel" id="teams"><div className="panel-title"><div><span>最近活跃</span><h2>团队池</h2></div></div>
            <div className="team-list">{teams.length ? teams.map((team) => <article key={team.id}><div className="team-avatar">{team.name.slice(0, 1)}</div><div><b>{team.name}</b><span>{team.ownerName} · {team.memberCount} 人</span></div><strong>{team.itemCount}<small> 项</small></strong></article>) : <p className="empty">尚无团队，首次小程序登录后会自动创建。</p>}</div>
          </section>
        </div>
        <section className="panel audit-panel" id="audit"><div className="panel-title"><div><span>SECURITY TRAIL</span><h2>最近操作</h2></div><small>不记录内容正文</small></div>
          <div className="audit-table"><div className="audit-head"><span>操作</span><span>成员</span><span>团队</span><span>时间</span></div>{recent.length ? recent.map((log) => <div className="audit-row" key={log.id}><span><i />{actionNames[log.action] || log.action}</span><span>{log.actorName || "匿名领取"}</span><span>{log.teamName || "—"}</span><time>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(log.createdAt.replace(" ", "T") + "Z"))}</time></div>) : <p className="empty">暂无操作记录。</p>}</div>
        </section>
      </section>
    </main>
  );
}
