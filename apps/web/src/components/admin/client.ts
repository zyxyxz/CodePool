"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

type Envelope<T> = { code: number; data: T; msg: string };

export async function adminRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });
  let payload: Envelope<T> | null = null;
  try { payload = await response.json() as Envelope<T>; } catch { /* handled below */ }
  if (response.status === 401) {
    globalThis.location.replace("/admin/login?expired=1");
    throw new Error("登录已失效");
  }
  if (!response.ok || !payload || payload.code !== 0) throw new Error(payload?.msg || "请求失败，请稍后重试");
  return payload.data;
}

export function useAdminData<T>(url: string) {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const requestKey = `${url}::${version}`;
  const [state, setState] = useState<{ key: string; data: T | null; error: string }>({ key: "", data: null, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    adminRequest<T>(url, { signal: controller.signal })
      .then((result) => setState({ key: requestKey, data: result, error: "" }))
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setState({ key: requestKey, data: null, error: reason instanceof Error ? reason.message : "加载失败" });
      });
    return () => controller.abort();
  }, [url, requestKey]);

  const current = state.key === requestKey;
  return { data: current ? state.data : null, error: current ? state.error : "", loading: !current, reload };
}

export function useClampedPage(
  data: { page: number; totalPages: number } | null,
  setPage: Dispatch<SetStateAction<number>>,
) {
  useEffect(() => {
    if (!data) return;
    const lastPage = Math.max(1, data.totalPages);
    if (data.page > lastPage) setPage(lastPage);
  }, [data, setPage]);
}

export function formatDate(value?: string | null, includeTime = true) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", includeTime
    ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function compactNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}
