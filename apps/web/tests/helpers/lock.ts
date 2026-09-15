// For tests of unrelated business rules, construct a genuine short-lived grant
// in the isolated fixture DB; lock-specific tests exercise setup/verification.
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { db } from '../../src/server/db';
import { issueUnlock, lockState, pinHash } from '../../src/server/vault-lock';
const grants = new Map<string, string>();
export function unlockTestHeaders(token: string): Record<string, string> {
  if (!token) return {};
  const userId = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub;
  if (!lockState(userId)) {
    const salt = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO vault_locks(user_id,pin_salt,pin_hash) VALUES (?,?,?)').run(userId, salt, pinHash('827194', salt));
  }
  if (!grants.has(token)) grants.set(token, issueUnlock(new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } }) as NextRequest, userId).token);
  return { 'x-codepool-unlock': grants.get(token)! };
}
