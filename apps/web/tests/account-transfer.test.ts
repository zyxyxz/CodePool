import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Role } from "../src/server/access";
import type { ItemRow } from "../src/server/items";

const testDirectory = mkdtempSync(join(tmpdir(), "codepool-account-transfer-"));
process.env.CODEPOOL_DATABASE_PATH = join(testDirectory, "codepool.db");
process.env.CODEPOOL_JWT_SECRET = "codepool-account-transfer-test-secret-value";
process.env.CODEPOOL_MASTER_KEY = "codepool-account-transfer-test-master-key-value";
const dbPromise = import("../src/server/db").then((module) => module.db);
const authPromise = import("../src/server/auth");
const cryptoPromise = import("../src/server/crypto");
const routePromise = import("../src/app/api/v1/accounts/[accountId]/transfer/route");
const accountRoutePromise = import("../src/app/api/v1/accounts/[accountId]/route");
const itemRoutePromise = import("../src/app/api/v1/items/[itemId]/route");
const shareRoutePromise = import("../src/app/api/v1/shares/public/[token]/route");
const seed = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test.after(async () => {
  (await dbPromise).close();
  rmSync(testDirectory, { recursive: true, force: true });
});

async function fixture(sourceRole: Role = "owner", targetRole: Role = "admin") {
  const db = await dbPromise;
  const { createSessionToken } = await authPromise;
  const { encrypt, hashToken } = await cryptoPromise;
  const userId = randomUUID();
  const sourceMemberId = randomUUID();
  const sourceTeamId = randomUUID();
  const targetTeamId = randomUUID();
  const accountId = randomUUID();
  const shareId = randomUUID();
  const shareToken = randomUUID();
  const openId = `test_${userId}`;
  db.prepare("INSERT INTO users(id, open_id) VALUES (?, ?)").run(userId, openId);
  db.prepare("INSERT INTO users(id, open_id) VALUES (?, ?)").run(sourceMemberId, `test_${sourceMemberId}`);
  for (const [teamId, role] of [[sourceTeamId, sourceRole], [targetTeamId, targetRole]]) {
    db.prepare("INSERT INTO teams(id, name, slug, owner_id) VALUES (?, ?, ?, ?)").run(teamId, teamId, teamId, userId);
    db.prepare("INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, ?)").run(teamId, userId, role);
  }
  db.prepare("INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, 'member')").run(sourceTeamId, sourceMemberId);
  const encrypted = encrypt(seed);
  db.prepare(`INSERT INTO vault_items(id, team_id, kind, title, identifier, cipher_text, iv, auth_tag, metadata, created_by)
    VALUES (?, ?, 'totp', 'GitHub', '成员', ?, ?, ?, ?, ?)`).run(
    accountId, sourceTeamId, encrypted.cipherText, encrypted.iv, encrypted.authTag,
    JSON.stringify({ issuer: "GitHub", label: "成员", algorithm: "SHA1", digits: 8, period: 30, remark: "保留备注" }), userId,
  );
  db.prepare("INSERT INTO share_links(id, token_hash, item_id, created_by, expires_at, max_views) VALUES (?, ?, ?, ?, ?, 10)")
    .run(shareId, hashToken(shareToken), accountId, userId, new Date(Date.now() + 3600_000).toISOString());
  const token = await createSessionToken({ userId, openId, scope: "member" });
  const sourceMemberToken = await createSessionToken({ userId: sourceMemberId, scope: "member" });
  return { userId, sourceMemberToken, token, sourceTeamId, targetTeamId, accountId, shareId, shareToken };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(token: string, body?: Record<string, unknown>, method = body ? "POST" : "GET") {
  return new Request("http://localhost/api/v1/accounts/test/transfer", {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
async function transfer(f: Fixture, body = { sourceTeamId: f.sourceTeamId, targetTeamId: f.targetTeamId }) {
  return (await routePromise).POST(request(f.token, body), { params: Promise.resolve({ accountId: f.accountId }) });
}
async function assertUnchanged(f: Fixture) {
  const db = await dbPromise;
  assert.equal((db.prepare("SELECT team_id FROM vault_items WHERE id = ?").get(f.accountId) as ItemRow).team_id, f.sourceTeamId);
  assert.equal((db.prepare("SELECT revoked_at FROM share_links WHERE id = ?").get(f.shareId) as { revoked_at: string | null }).revoked_at, null);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE target_id = ?").get(f.accountId) as { count: number }).count, 0);
}

test("transfer preserves encrypted TOTP, revokes old links and changes team access atomically", async () => {
  const f = await fixture();
  const db = await dbPromise;
  const before = db.prepare("SELECT * FROM vault_items WHERE id = ?").get(f.accountId) as ItemRow;
  const response = await transfer(f);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.account.teamId, f.targetTeamId);
  assert.equal(payload.data.account.id, f.accountId);
  assert.equal(payload.data.revokedShareCount, 1);
  const after = db.prepare("SELECT * FROM vault_items WHERE id = ?").get(f.accountId) as ItemRow;
  for (const field of ["cipher_text", "iv", "auth_tag", "metadata", "created_by", "created_at"] as const) {
    assert.equal(after[field], before[field]);
    if (["cipher_text", "iv", "auth_tag"].includes(field)) assert.equal(JSON.stringify(payload).includes(after[field]), false);
  }
  const { decrypt } = await cryptoPromise;
  const { generateTotp } = await import("../src/server/totp");
  assert.equal(generateTotp(decrypt({ cipherText: after.cipher_text, iv: after.iv, authTag: after.auth_tag }), { digits: 8, now: 59000 }).code, "94287082");
  const auditRows = db.prepare("SELECT team_id, action FROM audit_logs WHERE target_id = ? ORDER BY action").all(f.accountId);
  assert.deepEqual(auditRows, [
    { team_id: f.targetTeamId, action: "TOTP_TRANSFER_IN" },
    { team_id: f.sourceTeamId, action: "TOTP_TRANSFER_OUT" },
  ]);
  const accountRoute = await accountRoutePromise;
  const context = { params: Promise.resolve({ accountId: f.accountId }) };
  assert.equal((await accountRoute.GET(request(f.sourceMemberToken), context)).status, 404);
  assert.equal((await accountRoute.GET(request(f.token), context)).status, 200);
  assert.equal((await accountRoute.PATCH(request(f.sourceMemberToken, { label: "不能修改" }, "PATCH"), context)).status, 404);
  assert.equal((await accountRoute.DELETE(request(f.sourceMemberToken, undefined, "DELETE"), context)).status, 404);
  const shareRoute = await shareRoutePromise;
  const shareContext = { params: Promise.resolve({ token: f.shareToken }) };
  assert.equal((await shareRoute.GET(request(f.token), shareContext)).status, 410);
  assert.equal((await shareRoute.POST(request(f.token, {}), shareContext)).status, 410);
  const shares = await import("../src/app/api/v1/shares/route");
  assert.equal((await shares.POST(request(f.sourceMemberToken, { itemId: f.accountId }))).status, 404);
  assert.equal((await shares.POST(request(f.token, { itemId: f.accountId }))).status, 201);
});

test("transfer requires administrator permissions in both teams", async () => {
  for (const roles of [["member", "admin"], ["guest", "owner"], ["owner", "member"], ["admin", "guest"]] as Array<[Role, Role]>) {
    const f = await fixture(...roles);
    assert.equal((await transfer(f)).status, 403);
    await assertUnchanged(f);
  }
  const f = await fixture();
  (await dbPromise).prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").run(f.targetTeamId, f.userId);
  assert.equal((await transfer(f)).status, 403);
  await assertUnchanged(f);
});

test("transfer rejects inactive teams and expired memberships", async () => {
  const db = await dbPromise;
  for (const side of ["sourceTeamId", "targetTeamId"] as const) {
    for (const disabled of [true, false]) {
      const f = await fixture();
      if (disabled) db.prepare("UPDATE teams SET status = 'disabled' WHERE id = ?").run(f[side]);
      else db.prepare("UPDATE team_members SET expires_at = '2000-01-01T00:00:00.000Z' WHERE team_id = ? AND user_id = ?").run(f[side], f.userId);
      assert.equal((await transfer(f)).status, 403);
      await assertUnchanged(f);
    }
  }
});

test("transfer rejects disabled users and revoked sessions", async () => {
  for (const mutation of ["status = 'disabled'", "session_version = session_version + 1"]) {
    const f = await fixture();
    (await dbPromise).prepare(`UPDATE users SET ${mutation} WHERE id = ?`).run(f.userId);
    assert.equal((await transfer(f)).status, 401);
    await assertUnchanged(f);
  }
});

test("transfer rejects disabled and expired TOTP entries", async () => {
  for (const mutation of ["status = 'disabled'", "expires_at = '2000-01-01T00:00:00Z'"]) {
    const f = await fixture();
    (await dbPromise).prepare(`UPDATE vault_items SET ${mutation} WHERE id = ?`).run(f.accountId);
    assert.equal((await transfer(f)).status, 404);
    await assertUnchanged(f);
  }
});

test("transfer rechecks sessions after reading a delayed request body", async () => {
  const f = await fixture();
  const db = await dbPromise;
  const req = request(f.token, { sourceTeamId: f.sourceTeamId, targetTeamId: f.targetTeamId }) as Request;
  Object.defineProperty(req, "body", { get() {
    db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(f.userId);
    return new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ sourceTeamId: f.sourceTeamId, targetTeamId: f.targetTeamId })));
      controller.close();
    } });
  } });
  const response = await (await routePromise).POST(req as never, { params: Promise.resolve({ accountId: f.accountId }) });
  assert.equal(response.status, 401);
  await assertUnchanged(f);
});

test("transfer detects stale source and never silently moves back", async () => {
  const f = await fixture();
  assert.equal((await transfer(f)).status, 200);
  const response = await transfer(f);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "ACCOUNT_TEAM_CHANGED");
});

test("transfer rejects same-team, malformed and non-TOTP requests", async () => {
  const f = await fixture();
  assert.equal((await transfer(f, { sourceTeamId: f.sourceTeamId, targetTeamId: f.sourceTeamId })).status, 422);
  const { POST } = await routePromise;
  assert.equal((await POST(request(f.token, { targetTeamId: f.targetTeamId }), { params: Promise.resolve({ accountId: f.accountId }) })).status, 422);
  (await dbPromise).prepare("UPDATE vault_items SET kind = 'secret' WHERE id = ?").run(f.accountId);
  assert.equal((await transfer(f)).status, 404);
  await assertUnchanged(f);
});

test("transfer enforces destination quotas and maintenance without partial writes", async () => {
  const db = await dbPromise;
  try {
    const quotaFixture = await fixture();
    db.prepare("INSERT INTO platform_settings(key, value) VALUES ('platform', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify({ maxItemsPerTeam: 1 }));
    db.prepare(`INSERT INTO vault_items(id, team_id, kind, title, cipher_text, iv, auth_tag, created_by)
      VALUES (?, ?, 'note', '占用配额', '', '', '', ?)`).run(randomUUID(), quotaFixture.targetTeamId, quotaFixture.userId);
    const quotaResponse = await transfer(quotaFixture);
    assert.equal(quotaResponse.status, 409);
    assert.equal((await quotaResponse.json()).error, "ITEM_QUOTA_EXCEEDED");
    await assertUnchanged(quotaFixture);
    const maintenanceFixture = await fixture();
    db.prepare("UPDATE platform_settings SET value = ? WHERE key = 'platform'").run(JSON.stringify({ maintenanceMode: true }));
    const maintenanceResponse = await transfer(maintenanceFixture);
    assert.equal(maintenanceResponse.status, 503);
    assert.equal((await maintenanceResponse.json()).error, "MAINTENANCE_MODE");
    await assertUnchanged(maintenanceFixture);
  } finally {
    db.prepare("DELETE FROM platform_settings WHERE key = 'platform'").run();
  }
});

test("transfer rolls back the move and revoked links if either audit write fails", async () => {
  const f = await fixture();
  const db = await dbPromise;
  db.exec(`CREATE TEMP TRIGGER fail_transfer_audit BEFORE INSERT ON audit_logs
    WHEN NEW.action = 'TOTP_TRANSFER_IN' BEGIN SELECT RAISE(ABORT, 'test transfer audit failure'); END`);
  try {
    assert.equal((await transfer(f)).status, 500);
    await assertUnchanged(f);
  } finally { db.exec("DROP TRIGGER fail_transfer_audit"); }
});

test("transfer rate limit is enforced without an extra transfer", async () => {
  const f = await fixture();
  for (let index = 0; index < 20; index++) {
    const input = index % 2 === 0
      ? { sourceTeamId: f.sourceTeamId, targetTeamId: f.targetTeamId }
      : { sourceTeamId: f.targetTeamId, targetTeamId: f.sourceTeamId };
    assert.equal((await transfer(f, input)).status, 200);
  }
  const response = await transfer(f);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "ACCOUNT_TRANSFER_RATE_LIMITED");
  assert.equal(((await dbPromise).prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE target_id = ?").get(f.accountId) as { count: number }).count, 40);
});

test("generic item routes cannot expose or mutate TOTP seeds", async () => {
  const f = await fixture();
  const route = await itemRoutePromise;
  const context = { params: Promise.resolve({ itemId: f.accountId }) };
  assert.equal((await route.GET(request(f.token), context)).status, 404);
  assert.equal((await route.PATCH(request(f.sourceMemberToken, { content: "replacement-secret" }, "PATCH"), context)).status, 404);
  assert.equal((await route.DELETE(request(f.token, undefined, "DELETE"), context)).status, 404);
  const accounts = await accountRoutePromise;
  const accountContext = { params: Promise.resolve({ accountId: f.accountId }) };
  assert.equal((await accounts.PATCH(request(f.token, { teamId: f.targetTeamId }, "PATCH"), accountContext)).status, 422);
  await assertUnchanged(f);
});
