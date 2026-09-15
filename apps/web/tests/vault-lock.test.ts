import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
const directory = mkdtempSync(join(tmpdir(), 'codepool-lock-test-'));
process.env.CODEPOOL_DATABASE_PATH = join(directory, 'test.sqlite');
process.env.WECHAT_APP_ID = 'wx-test';
process.env.WECHAT_APP_SECRET = 'test-only-app-secret';
const dbPromise = import('../src/server/db').then((m) => m.db);
const authPromise = import('../src/server/auth');
const routePromise = import('../src/app/api/v1/auth/lock/route');
test.after(() => rmSync(directory, { recursive: true, force: true }));
function request(token: string, body?: unknown, grant?: string) {
  return new Request('http://localhost/api/v1/auth/lock', { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(grant ? { 'x-codepool-unlock': grant } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }) as never;
}
async function fixture() {
  const db = await dbPromise; const id = randomUUID();
  db.prepare('INSERT INTO users(id, open_id, nickname) VALUES (?, ?, ?)').run(id, id, '测试');
  const token = await (await authPromise).createSessionToken({ userId: id, openId: id, scope: 'member' });
  const route = await routePromise;
  const response = await route.POST(request(token, { action: 'setup', pin: '827194', confirmPin: '827194' }));
  assert.equal(response.status, 200);
  const grant = (await response.json()).data.token as string;
  return { db, id, token, route, grant };
}
test('PIN stored as salted hash; login JWT alone cannot read an enrolled vault', async () => {
  const f = await fixture();
  const row = f.db.prepare('SELECT * FROM vault_locks WHERE user_id = ?').get(f.id) as { pin_hash: string; pin_salt: string };
  assert.equal(row.pin_hash.length, 64); assert.notEqual(row.pin_hash, '827194');
  const auth = await authPromise;
  await assert.rejects(() => auth.requireMember(request(f.token)), /解锁/);
  await auth.requireMember(request(f.token, undefined, f.grant));
  const other = await fixture();
  await assert.rejects(() => auth.requireMember(request(other.token, undefined, f.grant)), /解锁/);
});
test('legacy users must enroll before business access; logging in again cannot bypass enrollment', async () => {
  const db = await dbPromise; const id = randomUUID();
  db.prepare('INSERT INTO users(id, open_id, nickname) VALUES (?, ?, ?)').run(id, id, '旧用户');
  const auth = await authPromise;
  for (let i = 0; i < 2; i++) {
    const token = await auth.createSessionToken({ userId: id, openId: id, scope: 'member' });
    await assert.rejects(() => auth.requireMember(request(token)), /设置安全 PIN/);
    const state = await (await routePromise).GET(request(token));
    assert.equal((await state.json()).data.configured, false);
  }
});
test('five wrong PIN attempts persist lockout and setup cannot reset it', async () => {
  const f = await fixture();
  for (let i = 0; i < 5; i++) {
    const response = await f.route.POST(request(f.token, { action: 'pin', pin: '938271' }));
    assert.equal(response.status, i === 4 ? 429 : 403);
  }
  assert.equal((await f.route.POST(request(f.token, { action: 'pin', pin: '827194' }))).status, 429);
  assert.equal((await f.route.POST(request(f.token, { action: 'setup', pin: '827194', confirmPin: '827194' }))).status, 409);
});
test('lock revokes grant and changing PIN revokes earlier grants', async () => {
  const f = await fixture();
  await f.route.DELETE(request(f.token, undefined, f.grant));
  await assert.rejects(() => (authPromise.then((m) => m.requireMember(request(f.token, undefined, f.grant)))), /解锁/);
  assert.equal((await f.route.POST(request(f.token, { action: 'change', pin: '917362', confirmPin: '917362' }))).status, 423);
  const next = await f.route.POST(request(f.token, { action: 'pin', pin: '827194' }));
  const grant = (await next.json()).data.token;
  assert.equal((await f.route.POST(request(f.token, { action: 'change', pin: '917362', confirmPin: '917362' }, grant))).status, 200);
  assert.equal((await f.route.POST(request(f.token, { action: 'pin', pin: '827194' }))).status, 403);
  await assert.rejects(() => (authPromise.then((m) => m.requireMember(request(f.token, undefined, grant)))), /解锁/);
});
test('biometric challenge is session-bound, verified remotely and single-use', async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  let verified = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('stable_token')) return Response.json({ access_token: 'test-token', expires_in: 7200 });
    const data = JSON.parse(String(init?.body));
    assert.equal(data.openid, f.id); verified++;
    return Response.json({ errcode: 0, is_ok: true });
  };
  try {
    const challenge = (await (await f.route.POST(request(f.token, { action: 'challenge' }))).json()).data.challenge;
    const body = { action: 'biometric', resultJSON: JSON.stringify({ raw: challenge }), signature: 'mock-only-signature' };
    const other = await fixture();
    assert.equal((await f.route.POST(request(other.token, body))).status, 403);
    assert.equal(verified, 0);
    assert.equal((await f.route.POST(request(f.token, body))).status, 200);
    assert.equal(verified, 1);
    assert.equal((await f.route.POST(request(f.token, body))).status, 403);
  } finally { globalThis.fetch = originalFetch; }
});
test('upstream signature rejection never issues an unlock grant', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ is_ok: false });
  try {
    const challenge = (await (await f.route.POST(request(f.token, { action: 'challenge' }))).json()).data.challenge;
    assert.equal((await f.route.POST(request(f.token, { action: 'biometric', resultJSON: JSON.stringify({ raw: challenge }), signature: 'forged' }))).status, 403);
  } finally { globalThis.fetch = original; }
});
