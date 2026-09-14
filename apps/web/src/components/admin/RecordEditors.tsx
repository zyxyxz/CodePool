"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { adminRequest } from './client';

const colors = [['#15803D', '鼠尾草'], ['#2563EB', '雾霭蓝'], ['#7C3AED', '香芋紫'], ['#DB2777', '蔷薇粉'], ['#EA580C', '杏仁桃'], ['#0891B2', '薄荷青']];

export function MemberRoleEditor({ teamId, userId, role, onSaved }: { teamId: string; userId: string; role: string; onSaved: () => void }) {
  const [next, setNext] = useState(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy || next === role) return;
    setBusy(true); setError('');
    try {
      await adminRequest(`/api/admin/teams/${teamId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role: next }) });
      if (active.current) onSaved();
    } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { if (active.current) setBusy(false); }
  }
  return <form onSubmit={save} className="admin-member-role-editor"><select aria-label="成员角色" value={next} disabled={busy} onChange={(e) => setNext(e.target.value)}><option value="admin">管理员</option><option value="member">成员</option><option value="guest">访客</option></select><button className="admin-button secondary" type="submit" disabled={busy || next === role}>{busy ? '保存中' : '保存角色'}</button>{error && <small role="alert">{error}</small>}</form>;
}

export function RecordEditor({ kind, record, onSaved }: {
  kind: 'users' | 'teams'; record: { id: string; nickname?: string; name?: string; avatarUrl?: string | null; themeColor?: string }; onSaved: () => void;
}) {
  const [name, setName] = useState(record.nickname ?? record.name ?? '');
  const [color, setColor] = useState(record.themeColor ?? '#15803D');
  const [avatar, setAvatar] = useState<{ data: string; mimeType: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const isUser = kind === 'users';
  async function chooseFile(file?: File) {
    const sequence = ++generation.current;
    setAvatar(null); setError(''); setNotice(''); setReading(false);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 512 * 1024) {
      setError('请选择不超过 512KB 的 JPEG、PNG 或 WebP 图片'); return;
    }
    setReading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('读取图片失败，请重新选择'));
        reader.readAsDataURL(file);
      });
      if (alive.current && generation.current === sequence) setAvatar({ data, mimeType: file.type });
    } catch (reason) { if (alive.current && generation.current === sequence) setError(reason instanceof Error ? reason.message : '读取失败'); }
    finally { if (alive.current && generation.current === sequence) setReading(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current || reading) return;
    saving.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await adminRequest(`/api/admin/${kind}/${record.id}`, {
        method: 'PATCH', body: JSON.stringify(isUser ? { nickname: name.trim(), ...(avatar ? { avatar } : {}) } : { name: name.trim(), themeColor: color }),
      });
      if (alive.current) { setAvatar(null); setNotice('已保存，变更已记录到审计日志'); onSaved(); }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
    finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const preview = avatar ? `data:${avatar.mimeType};base64,${avatar.data}` : record.avatarUrl;
  return <section><div className="admin-section-title"><h3>{isUser ? '编辑用户资料' : '编辑团队信息'}</h3><span>不改变账号或团队状态</span></div>
    <form className="admin-record-editor" onSubmit={save}>
      <fieldset disabled={busy || reading}>
        <label>{isUser ? '昵称' : '团队名称'}<input value={name} onChange={(e) => setName(e.target.value)} required minLength={isUser ? 1 : 2} maxLength={isUser ? 64 : 48} /></label>
        {isUser ? <label>头像{preview && <Image src={preview} alt="用户头像预览" width={72} height={72} unoptimized style={{ borderRadius: 16, objectFit: 'cover' }} />}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void chooseFile(e.target.files?.[0])} /><small>支持 JPEG、PNG、WebP，最大 512KB；不选择图片则保留原头像。</small></label> : <label>主题色<select value={color} onChange={(e) => setColor(e.target.value)}>{colors.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><span style={{ background: color, width: 32, height: 8, borderRadius: 4 }} /></label>}
      </fieldset>
      {error && <p role="alert" className="admin-inline-warning">{error}</p>}{notice && <p role="status">{notice}</p>}
      <button className="admin-button primary" type="submit" disabled={busy || reading}>{reading ? '读取头像…' : busy ? '保存中…' : '保存修改'}</button>
    </form>
  </section>;
}
