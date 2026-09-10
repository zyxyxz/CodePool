import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Role } from "../src/server/access";

const testDirectory = mkdtempSync(join(tmpdir(), "codepool-team-settings-"));
process.env.CODEPOOL_DATABASE_PATH = join(testDirectory, "codepool.db");
process.env.CODEPOOL_JWT_SECRET = "codepool-team-settings-test-secret-value";
process.env.WECHAT_MOCK_LOGIN = "true";
const dbPromise = import("../src/server/db").then((module) => module.db);
const authPromise = import("../src/server/auth");
const routePromise = import("../src/app/api/v1/teams/[teamId]/route");

test.after(async () => {
  (await dbPromise).close();
  rmSync(testDirectory, { recursive: true, force: true });
});

async function fixture(role: Role = "owner") {
  const db = await dbPromise;
  const { createSessionToken } = await authPromise;
  const userId = randomUUID();
  const teamId = randomUUID();
  db.prepare("INSERT INTO users(id, open_id) VALUES (?, ?)").run(userId, `test_${userId}`);
  db.prepare("INSERT INTO teams(id, name, slug, owner_id) VALUES (?, '原团队', ?, ?)").run(teamId, teamId, userId);
  db.prepare("INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, ?)").run(teamId, userId, role);
  return { userId, teamId, token: await createSessionToken({ userId, scope: "member" }) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function request(token: string, body?: Record<string, unknown>, method = body ? "PATCH" : "GET") {
  return new Request("http://localhost/api/v1/teams/test", {
    method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never;
}
async function update(f: Fixture, body: Record<string, unknown>) {
  return (await routePromise).PATCH(request(f.token, body), { params: Promise.resolve({ teamId: f.teamId }) });
}
async function stored(f: Fixture) {
  return (await dbPromise).prepare("SELECT name, theme_color AS themeColor FROM teams WHERE id = ?").get(f.teamId);
}

test("owners and admins update team name and theme without changing its identity", async () => {
  for (const role of ["owner", "admin"] as const) {
    const f = await fixture(role);
    const response = await update(f, { name: "  工程团队  ", themeColor: "#2563EB" });
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data.teamId, f.teamId);
    assert.equal(data.slug, f.teamId);
    assert.equal(data.ownerId, f.userId);
    assert.equal(data.role, role);
    assert.deepEqual(await stored(f), { name: "工程团队", themeColor: "#2563EB" });
    const auditRow = (await dbPromise).prepare("SELECT action, detail FROM audit_logs WHERE target_id = ?").get(f.teamId) as { action: string; detail: string };
    assert.equal(auditRow.action, "TEAM_UPDATE");
    assert.deepEqual(JSON.parse(auditRow.detail), { fields: ["name", "themeColor"] });
    assert.equal((await update(f, { themeColor: "#0891B2" })).status, 200);
    assert.deepEqual(await stored(f), { name: "工程团队", themeColor: "#0891B2" });
  }
});

test("team lists and refreshed profile agree on persisted theme", async () => {
  const f = await fixture();
  assert.deepEqual(await stored(f), { name: "原团队", themeColor: "#15803D" });
  assert.equal((await update(f, { name: "产品设计", themeColor: "#7C3AED" })).status, 200);
  const teams = await import("../src/app/api/v1/teams/route");
  const me = await import("../src/app/api/v1/auth/me/route");
  const listed = await (await teams.GET(request(f.token))).json();
  const profile = await (await me.GET(request(f.token))).json();
  assert.equal(listed.data[0].name, "产品设计");
  assert.equal(listed.data[0].themeColor, "#7C3AED");
  assert.equal(profile.data.teams[0].themeColor, "#7C3AED");
});

test("team update returns the same nonzero counts and team identity as the list", async () => {
  const f = await fixture("admin");
  const db = await dbPromise;
  for (const state of ["active", "disabled", "expired"]) {
    const userId = randomUUID();
    db.prepare("INSERT INTO users(id, open_id, status) VALUES (?, ?, ?)").run(userId, `test_${userId}`, state === "disabled" ? "disabled" : "active");
    db.prepare("INSERT INTO team_members(team_id, user_id, role, expires_at) VALUES (?, ?, 'member', ?)")
      .run(f.teamId, userId, state === "expired" ? "2000-01-01T00:00:00Z" : null);
  }
  for (const status of ["active", "disabled"]) {
    db.prepare(`INSERT INTO vault_items(id, team_id, kind, title, cipher_text, iv, auth_tag, created_by, status)
      VALUES (?, ?, 'note', '团队内容', '', '', '', ?, ?)`).run(randomUUID(), f.teamId, f.userId, status);
  }
  const response = await update(f, { name: "改名后团队", themeColor: "#EA580C" });
  assert.equal(response.status, 200);
  const updated = (await response.json()).data;
  const teams = await import("../src/app/api/v1/teams/route");
  const listed = (await (await teams.GET(request(f.token))).json()).data[0];
  assert.equal(updated.memberCount, 2);
  assert.equal(updated.itemCount, 2);
  for (const field of ["teamId", "name", "slug", "ownerId", "role", "themeColor", "memberCount", "itemCount", "createdAt"]) {
    assert.equal(updated[field], listed[field], field);
  }
});

test("new login teams and explicit team creation include theme defaults", async () => {
  const login = await import("../src/app/api/v1/auth/login/route");
  const loginResponse = await login.POST(request("", { wx_code: randomUUID() }, "POST"));
  assert.equal(loginResponse.status, 201);
  const loginData = (await loginResponse.json()).data;
  assert.equal(loginData.user.teams[0].themeColor, "#15803D");
  const teams = await import("../src/app/api/v1/teams/route");
  const response = await teams.POST(request(loginData.accessToken, { name: "新建蓝色团队", themeColor: "#2563EB" }, "POST"));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).data.themeColor, "#2563EB");
});

test("team settings reject members, guests, expired memberships and disabled teams", async () => {
  const db = await dbPromise;
  for (const role of ["member", "guest"] as const) {
    const f = await fixture(role);
    assert.equal((await update(f, { name: "不允许修改" })).status, 403);
    assert.deepEqual(await stored(f), { name: "原团队", themeColor: "#15803D" });
  }
  for (const expire of [true, false]) {
    const f = await fixture();
    if (expire) db.prepare("UPDATE team_members SET expires_at = '2000-01-01T00:00:00Z' WHERE team_id = ?").run(f.teamId);
    else db.prepare("UPDATE teams SET status = 'disabled' WHERE id = ?").run(f.teamId);
    assert.equal((await update(f, { themeColor: "#2563EB" })).status, 403);
    assert.deepEqual(await stored(f), { name: "原团队", themeColor: "#15803D" });
  }
});

test("team settings reject invalid input and prevent ownership changes", async () => {
  const f = await fixture();
  for (const body of [{}, { name: " " }, { name: "a" }, { name: "长".repeat(49) }, { themeColor: "red" }, { themeColor: "#000000" }, { ownerId: randomUUID() }, { slug: "changed" }]) {
    assert.equal((await update(f, body)).status, 422);
  }
  assert.deepEqual(await stored(f), { name: "原团队", themeColor: "#15803D" });
});

test("team settings enforce maintenance and current session", async () => {
  const f = await fixture();
  const db = await dbPromise;
  db.prepare("INSERT INTO platform_settings(key, value) VALUES ('platform', ?)").run(JSON.stringify({ maintenanceMode: true }));
  try {
    assert.equal((await update(f, { name: "维护期间" })).status, 503);
    assert.deepEqual(await stored(f), { name: "原团队", themeColor: "#15803D" });
  } finally { db.prepare("DELETE FROM platform_settings WHERE key = 'platform'").run(); }
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(f.userId);
  assert.equal((await update(f, { name: "会话过期" })).status, 401);
});

test("team settings roll back if audit persistence fails", async () => {
  const f = await fixture();
  const db = await dbPromise;
  db.exec("CREATE TEMP TRIGGER fail_team_update_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'TEAM_UPDATE' BEGIN SELECT RAISE(ABORT, 'test team audit failure'); END");
  try {
    assert.equal((await update(f, { name: "原子更新", themeColor: "#DB2777" })).status, 500);
    assert.deepEqual(await stored(f), { name: "原团队", themeColor: "#15803D" });
  } finally { db.exec("DROP TRIGGER fail_team_update_audit"); }
});

test("team settings rate-limit repeated updates", async () => {
  const f = await fixture();
  for (let index = 0; index < 60; index++) assert.equal((await update(f, { name: `团队${index}` })).status, 200);
  const response = await update(f, { name: "达到限流" });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "TEAM_WRITE_RATE_LIMITED");
  assert.deepEqual(await stored(f), { name: "团队59", themeColor: "#15803D" });
});
