import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { getAdminSession } from "@/server/auth";

export default async function LoginPage() {
  if (await getAdminSession()) redirect("/admin");
  return (
    <main className="login-page">
      <div className="login-brand"><span className="brand-mark">C</span><span>CodePool</span></div>
      <section className="login-card"><span className="kicker">ADMIN CONSOLE</span><h1>欢迎回来</h1><p>管理团队、共享内容元数据和安全审计。</p><LoginForm /></section>
      <p className="security-note">管理端不会展示 TOTP 密钥或内容正文</p>
    </main>
  );
}
