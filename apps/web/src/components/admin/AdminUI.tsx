"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, LoaderCircle, RefreshCw, Search, X } from "lucide-react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <header className="admin-page-header"><div><span className="admin-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="admin-page-actions">{actions}</div>}</header>;
}

export function LoadingState({ label = "正在加载运营数据" }: { label?: string }) {
  return <div className="admin-state"><LoaderCircle className="spin" size={24} /><b>{label}</b><span>请稍候</span></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="admin-state error"><AlertCircle size={25} /><b>数据加载失败</b><span>{message}</span><button className="admin-button secondary" type="button" onClick={onRetry}><RefreshCw size={15} />重新加载</button></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="admin-state empty"><span className="admin-empty-icon"><Inbox size={24} /></span><b>{title}</b><span>{description}</span>{action}</div>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const labels: Record<string, string> = { active: "正常", disabled: "已停用", unavailable: "关联资源不可用", suspended: "已冻结", archived: "已归档", deleted: "已删除", expired: "已过期", used: "已使用", consumed: "已领取", revoked: "已撤销", pending: "待使用", healthy: "正常", warning: "需处理" };
  return <span className={`admin-status ${status}`}><i />{label || labels[status] || status}</span>;
}

export function SearchField({ value, onChange, placeholder = "搜索" }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="admin-search"><Search size={16} /><input value={value} maxLength={120} onChange={(event) => onChange(event.target.value.slice(0, 120))} placeholder={placeholder} aria-label={placeholder} />{value && <button type="button" onClick={() => onChange("")} aria-label="清空搜索"><X size={14} /></button>}</label>;
}

export function ConfirmDialog({ open, title, description, confirmLabel, danger, busy, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; danger?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="admin-modal-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onCancel(); }}><section className="admin-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><span className={`admin-modal-icon${danger ? " danger" : ""}`}>{danger ? <AlertCircle size={22} /> : <CheckCircle2 size={22} />}</span><h2 id="confirm-title">{title}</h2><p>{description}</p><div><button type="button" className="admin-button secondary" onClick={onCancel} disabled={busy}>取消</button><button type="button" className={`admin-button${danger ? " danger" : " primary"}`} onClick={onConfirm} disabled={busy}>{busy ? "处理中…" : confirmLabel}</button></div></section></div>;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <div className="admin-pagination"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button><span>第 {page} / {totalPages} 页</span><button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>下一页</button></div>;
}
