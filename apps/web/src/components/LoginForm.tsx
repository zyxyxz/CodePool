"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const result = await response.json().catch(() => null) as { msg?: string } | null;
      if (!response.ok) {
        setError(result?.msg || "登录失败，请稍后重试");
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch {
      setError("网络连接失败，请检查连接后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label>管理员邮箱<input name="email" type="email" autoComplete="username" placeholder="admin@codepool.local" required /></label>
      <label>密码<input name="password" type="password" autoComplete="current-password" placeholder="••••••••••••" required /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="button primary" disabled={loading}>{loading ? "验证中…" : "进入控制台 →"}</button>
    </form>
  );
}
