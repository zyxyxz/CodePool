"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  Activity,
  Boxes,
  ChevronRight,
  ClipboardCheck,
  FileKey2,
  Gauge,
  LogOut,
  Menu,
  Settings,
  Share2,
  ShieldCheck,
  Users,
  UsersRound,
  UserRoundX,
  X,
} from "lucide-react";

const navigation = [
  { href: "/admin", label: "运营总览", icon: Gauge, exact: true },
  { href: "/admin/teams", label: "团队管理", icon: UsersRound },
  { href: "/admin/users", label: "用户管理", icon: Users },
  { href: "/admin/deletions", label: "注销申请", icon: UserRoundX },
  { href: "/admin/content", label: "内容治理", icon: Boxes },
  { href: "/admin/shares", label: "分享与邀请", icon: Share2 },
  { href: "/admin/audit", label: "安全审计", icon: ClipboardCheck },
  { href: "/admin/system", label: "系统设置", icon: Settings },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const active = navigation.find((item) => item.exact ? pathname === item.href : pathname.startsWith(item.href));

  return (
    <div className="admin-app">
      <a className="skip-link" href="#admin-content">跳到主要内容</a>
      <button className="admin-mobile-menu" type="button" onClick={() => setMenuOpen(true)} aria-label="打开导航">
        <Menu size={20} />
      </button>
      {menuOpen && <button className="admin-sidebar-backdrop" type="button" aria-label="关闭导航" onClick={() => setMenuOpen(false)} />}
      <aside className={`admin-sidebar${menuOpen ? " open" : ""}`}>
        <div className="admin-sidebar-top">
          <Link href="/admin" className="brand"><span className="brand-mark">C</span><span>CodePool</span></Link>
          <button className="admin-sidebar-close" type="button" onClick={() => setMenuOpen(false)} aria-label="关闭导航"><X size={19} /></button>
        </div>
        <div className="admin-workspace">
          <span className="admin-workspace-icon"><ShieldCheck size={17} /></span>
          <div><small>运营空间</small><strong>CodePool 生产环境</strong></div>
          <ChevronRight size={15} />
        </div>
        <nav className="admin-nav" aria-label="运营后台导航">
          <span className="admin-nav-label">管理中心</span>
          {navigation.map((item) => {
            const selected = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const Icon = item.icon;
            return <Link href={item.href} onClick={() => setMenuOpen(false)} className={selected ? "selected" : ""} aria-current={selected ? "page" : undefined} key={item.href}><Icon size={17} /><span>{item.label}</span>{selected && <i />}</Link>;
          })}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-service-state"><span><Activity size={15} /></span><div><b>生产运营控制台</b><small>状态与上线检查见系统设置</small></div></div>
          <form action="/api/admin/logout" method="post"><button type="submit"><LogOut size={16} />退出登录</button></form>
        </div>
      </aside>
      <div className="admin-stage">
        <header className="admin-topbar">
          <div><small>运营管理 /</small><strong>{active?.label || "管理中心"}</strong></div>
          <div className="admin-topbar-actions">
            <Link href="/" target="_blank"><FileKey2 size={15} />查看官网</Link>
            <span className="admin-admin-avatar">管</span>
          </div>
        </header>
        <main id="admin-content" className="admin-content">{children}</main>
      </div>
    </div>
  );
}
