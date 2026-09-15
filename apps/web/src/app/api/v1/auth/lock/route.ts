import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ApiError, fail, jsonBody, ok } from '@/server/api';
import { assertMemberSession, requireMember } from '@/server/auth';
import { db } from '@/server/db';
import { audit } from '@/server/audit';
import { assertVaultUnlocked, digest, issueUnlock, lockState, pinHash, sessionHash, verifyPin } from '@/server/vault-lock';
import { verifySoter } from '@/server/soter';
import { enforceRateLimit } from '@/server/rate-limit';

const pin = z.string().regex(/^\d{6}$/);
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup'), pin, confirmPin: pin }).strict(),
  z.object({ action: z.literal('pin'), pin }).strict(),
  z.object({ action: z.literal('change'), pin, confirmPin: pin }).strict(),
  z.object({ action: z.literal('challenge') }).strict(),
  z.object({ action: z.literal('biometric'), resultJSON: z.string().max(8192), signature: z.string().min(1).max(8192) }).strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const session = await requireMember(request, { allowLocked: true });
    const state = lockState(session.userId);
    return ok({ configured: Boolean(state), retryAfter: state ? Math.max(0, Math.ceil((state.blocked_until - Date.now()) / 1000)) : 0 });
  } catch (error) { return fail(error); }
}
export async function DELETE(request: NextRequest) {
  try {
    const session = await requireMember(request, { allowLocked: true });
    db.prepare('DELETE FROM vault_unlocks WHERE token_hash = ? AND user_id = ? AND session_hash = ?').run(digest(request.headers.get('x-codepool-unlock') || ''), session.userId, sessionHash(request));
    return ok({ locked: true });
  } catch (error) { return fail(error); }
}
export async function POST(request: NextRequest) {
  try {
    const session = await requireMember(request, { allowLocked: true });
    enforceRateLimit(request, { namespace: 'vault-unlock', subject: `user:${session.userId}`, limit: 60, windowSeconds: 300, errorCode: 'UNLOCK_RATE_LIMITED' });
    const input = schema.parse(await jsonBody(request, 20_000));
    if (input.action === 'setup' || input.action === 'change') {
      if (input.pin !== input.confirmPin) throw new ApiError(422, '两次 PIN 不一致', 'PIN_MISMATCH');
      if (/^(\d)\1{5}$/.test(input.pin) || ['123456', '654321', '012345', '543210'].includes(input.pin)) throw new ApiError(422, '请勿使用连续或重复数字', 'PIN_WEAK');
      const salt = randomBytes(32).toString('hex');
      const hash = pinHash(input.pin, salt);
      return ok(db.transaction(() => {
        assertMemberSession(session);
        if (input.action === 'setup') {
          if (lockState(session.userId)) throw new ApiError(409, 'PIN 已设置，请解锁后修改', 'PIN_ALREADY_SET');
          db.prepare('INSERT INTO vault_locks(user_id, pin_salt, pin_hash) VALUES (?, ?, ?)').run(session.userId, salt, hash);
        } else {
          if (!lockState(session.userId)) throw new ApiError(409, '请先设置 PIN', 'PIN_NOT_SET');
          assertVaultUnlocked(request, session.userId);
          db.prepare('UPDATE vault_locks SET pin_salt = ?, pin_hash = ?, failures = 0, blocked_until = 0 WHERE user_id = ?').run(salt, hash, session.userId);
        }
        db.prepare('DELETE FROM vault_unlocks WHERE user_id = ?').run(session.userId);
        db.prepare('DELETE FROM vault_challenges WHERE user_id = ?').run(session.userId);
        audit({ request, actorId: session.userId, action: input.action === 'setup' ? 'VAULT_PIN_SETUP' : 'VAULT_PIN_CHANGE', targetType: 'user', targetId: session.userId });
        return issueUnlock(request, session.userId);
      }).immediate());
    }
    const initialLock = lockState(session.userId);
    if (!initialLock) throw new ApiError(409, '请先设置 PIN', 'PIN_NOT_SET');
    if (input.action === 'challenge') {
      const challenge = randomBytes(32).toString('hex');
      db.transaction(() => {
        assertMemberSession(session);
        db.prepare('DELETE FROM vault_challenges WHERE expires_at <= ? OR (user_id = ? AND session_hash = ?)').run(Date.now(), session.userId, sessionHash(request));
        db.prepare('INSERT INTO vault_challenges VALUES (?, ?, ?, ?)').run(challenge, session.userId, sessionHash(request), Date.now() + 120_000);
      }).immediate();
      return ok({ challenge });
    }
    if (input.action === 'pin') verifyPin(session.userId, input.pin);
    else {
      let raw: unknown;
      try { raw = JSON.parse(input.resultJSON).raw; } catch { throw new ApiError(403, '生物认证结果无效', 'BIOMETRIC_REJECTED'); }
      if (typeof raw !== 'string') throw new ApiError(403, '生物认证结果无效', 'BIOMETRIC_REJECTED');
      const challenge = db.prepare('DELETE FROM vault_challenges WHERE challenge = ? AND user_id = ? AND session_hash = ? AND expires_at > ? RETURNING challenge').get(raw, session.userId, sessionHash(request), Date.now());
      if (!challenge) throw new ApiError(403, '生物认证已过期，请重新验证', 'BIOMETRIC_REJECTED');
      const user = db.prepare('SELECT open_id FROM users WHERE id = ?').get(session.userId) as { open_id: string };
      await verifySoter(user.open_id, input.resultJSON, input.signature);
    }
    return ok(db.transaction(() => {
      assertMemberSession(session);
      if (lockState(session.userId)?.pin_hash !== initialLock.pin_hash) throw new ApiError(403, '安全设置已变更，请重新解锁', 'VAULT_LOCKED');
      audit({ request, actorId: session.userId, action: 'VAULT_UNLOCK', targetType: 'user', targetId: session.userId, detail: { method: input.action } });
      return issueUnlock(request, session.userId);
    }).immediate());
  } catch (error) { return fail(error); }
}
