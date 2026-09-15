import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db } from './db';
import { ApiError } from './api';

export const UNLOCK_SECONDS = 600;
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const sessionHash = (request: NextRequest) => digest(request.headers.get('authorization') || '');
export const pinHash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');
type Lock = { pin_salt: string; pin_hash: string; failures: number; blocked_until: number };
export function lockState(userId: string) { return db.prepare('SELECT * FROM vault_locks WHERE user_id = ?').get(userId) as Lock | undefined; }
export function assertVaultUnlocked(request: NextRequest, userId: string) {
  if (!lockState(userId)) throw new ApiError(423, '请先设置安全 PIN', 'PIN_SETUP_REQUIRED');
  const token = request.headers.get('x-codepool-unlock') || '';
  const grant = token && db.prepare('SELECT 1 FROM vault_unlocks WHERE token_hash = ? AND user_id = ? AND session_hash = ? AND expires_at > ?')
    .get(digest(token), userId, sessionHash(request), Date.now());
  if (!grant) throw new ApiError(423, '请先解锁密钥钱包', 'VAULT_LOCKED');
}
export function issueUnlock(request: NextRequest, userId: string) {
  db.prepare('DELETE FROM vault_unlocks WHERE expires_at <= ?').run(Date.now());
  db.prepare('DELETE FROM vault_unlocks WHERE user_id = ? AND session_hash = ?').run(userId, sessionHash(request));
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO vault_unlocks VALUES (?, ?, ?, ?)').run(digest(token), userId, sessionHash(request), Date.now() + UNLOCK_SECONDS * 1000);
  return { token, expiresIn: UNLOCK_SECONDS };
}
export function verifyPin(userId: string, pin: string) {
  // Persist failed attempts OUTSIDE any transaction that throws/rolls back.
  const result = db.transaction(() => {
    const state = lockState(userId);
    if (!state) return 'missing';
    if (state.blocked_until > Date.now()) return 'blocked';
    if (!timingSafeEqual(Buffer.from(state.pin_hash, 'hex'), Buffer.from(pinHash(pin, state.pin_salt), 'hex'))) {
      const failures = state.blocked_until ? 1 : state.failures + 1;
      db.prepare('UPDATE vault_locks SET failures = ?, blocked_until = ? WHERE user_id = ?')
        .run(failures, failures >= 5 ? Date.now() + 15 * 60_000 : 0, userId);
      return failures >= 5 ? 'blocked' : 'wrong';
    }
    db.prepare('UPDATE vault_locks SET failures = 0, blocked_until = 0 WHERE user_id = ?').run(userId);
    return 'ok';
  }).immediate();
  if (result !== 'ok') throw new ApiError(result === 'blocked' ? 429 : 403,
    result === 'blocked' ? 'PIN 连续错误，请 15 分钟后重试，或使用生物识别' : 'PIN 不正确', 'PIN_REJECTED');
}
