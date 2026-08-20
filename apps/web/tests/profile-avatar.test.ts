import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";

const testDirectory = mkdtempSync(join(tmpdir(), "codepool-profile-avatar-"));
const jwtSecret = "codepool-profile-avatar-test-secret-value";
process.env.CODEPOOL_DATABASE_PATH = join(testDirectory, "codepool.db");
process.env.CODEPOOL_JWT_SECRET = jwtSecret;

const dbPromise = import("../src/server/db").then((module) => module.db);
const authPromise = import("../src/server/auth");
const meRoutePromise = import("../src/app/api/v1/auth/me/route");
const uploadRoutePromise = import("../src/app/api/v1/auth/avatar/route");
const avatarRoutePromise = import("../src/app/api/v1/avatars/[userId]/route");
const teamMembersRoutePromise = import("../src/app/api/v1/teams/[teamId]/members/route");
const auditLogsRoutePromise = import("../src/app/api/v1/audit/logs/route");

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.after(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

async function member() {
  const db = await dbPromise;
  const { createSessionToken } = await authPromise;
  const userId = randomUUID();
  const openId = `test_${randomUUID()}`;
  db.prepare("INSERT INTO users(id, open_id, nickname) VALUES (?, ?, ?)").run(
    userId,
    openId,
    "测试用户",
  );
  const token = await createSessionToken({ userId, openId, scope: "member" });
  return { userId, token };
}

function authenticatedJsonRequest(path: string, token: string, body: Record<string, unknown>, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  }) as never;
}

function authenticatedGetRequest(path: string, token: string) {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  Object.defineProperty(request, "nextUrl", { value: url });
  return request as never;
}

async function responseBody(response: Response) {
  return await response.json() as {
    code: number;
    data: Record<string, unknown> | null;
    error?: string;
  };
}

function avatarUrlFromPayload(payload: Awaited<ReturnType<typeof responseBody>>, key = "avatarUrl") {
  const value = payload.data?.[key];
  assert.equal(typeof value, "string");
  return value as string;
}

function signedUrlFor(userId: string, avatarVersion: number, expiresAt: number) {
  const key = createHmac("sha256", jwtSecret)
    .update("codepool-avatar-capability-key:v1")
    .digest();
  const signature = createHmac("sha256", key)
    .update(`v1:${userId}:${avatarVersion}:${expiresAt}`)
    .digest("base64url");
  return `/api/v1/avatars/${userId}?v=${avatarVersion}&exp=${expiresAt}&sig=${signature}`;
}

test("PATCH /auth/me persists a nickname and audits the update", async () => {
  const { userId, token } = await member();
  const { PATCH } = await meRoutePromise;
  const response = await PATCH(authenticatedJsonRequest(
    "/api/v1/auth/me",
    token,
    { nickname: "  新昵称  " },
    "PATCH",
  ));
  const payload = await responseBody(response);

  assert.equal(response.status, 200);
  assert.equal((payload.data?.user as { nickname: string }).nickname, "新昵称");
  const db = await dbPromise;
  assert.equal(
    (db.prepare("SELECT nickname FROM users WHERE id = ?").get(userId) as { nickname: string }).nickname,
    "新昵称",
  );
  assert.equal(
    (db.prepare("SELECT action FROM audit_logs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 1").get(userId) as { action: string }).action,
    "PROFILE_UPDATE",
  );
  assert.equal(JSON.stringify(payload).includes("avatar_blob"), false);
});

test("PATCH /auth/me atomically persists nickname and avatar", async () => {
  const { userId, token } = await member();
  const { PATCH } = await meRoutePromise;
  const response = await PATCH(authenticatedJsonRequest(
    "/api/v1/auth/me",
    token,
    {
      nickname: "原子资料",
      avatar: { data: pngBytes.toString("base64"), mimeType: "image/png" },
    },
    "PATCH",
  ));
  const payload = await responseBody(response);

  assert.equal(response.status, 200);
  const user = payload.data?.user as { nickname: string; avatarUrl: string; avatarVersion: number };
  assert.equal(user.nickname, "原子资料");
  assert.match(user.avatarUrl, new RegExp(`^/api/v1/avatars/${userId}\\?v=1&exp=\\d{10}&sig=[A-Za-z0-9_-]{43}$`));
  assert.equal(user.avatarVersion, 1);
  const db = await dbPromise;
  const actions = db
    .prepare("SELECT action FROM audit_logs WHERE actor_id = ? ORDER BY action")
    .all(userId) as Array<{ action: string }>;
  assert.deepEqual(actions.map((entry) => entry.action), ["PROFILE_AVATAR_UPDATE", "PROFILE_UPDATE"]);
});

test("PATCH /auth/me does not partially update nickname when avatar validation fails", async () => {
  const { userId, token } = await member();
  const { PATCH } = await meRoutePromise;
  const response = await PATCH(authenticatedJsonRequest(
    "/api/v1/auth/me",
    token,
    {
      nickname: "不应部分写入",
      avatar: { data: "iVBORw0KGgo=", mimeType: "image/png" },
    },
    "PATCH",
  ));

  assert.equal(response.status, 422);
  assert.equal((await responseBody(response)).error, "INVALID_AVATAR_IMAGE");
  const db = await dbPromise;
  const user = db
    .prepare("SELECT nickname, avatar_blob AS avatarBlob FROM users WHERE id = ?")
    .get(userId) as { nickname: string; avatarBlob: Buffer | null };
  assert.equal(user.nickname, "测试用户");
  assert.equal(user.avatarBlob, null);
});

test("POST /auth/avatar stores validated image bytes and returns a versioned relative URL", async () => {
  const { userId, token } = await member();
  const { POST } = await uploadRoutePromise;
  const response = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: pngBytes.toString("base64"), mimeType: "image/png" },
  ));
  const payload = await responseBody(response);

  assert.equal(response.status, 200);
  assert.equal(payload.data?.avatarVersion, 1);
  assert.match(
    avatarUrlFromPayload(payload),
    new RegExp(`^/api/v1/avatars/${userId}\\?v=1&exp=\\d{10}&sig=[A-Za-z0-9_-]{43}$`),
  );
  const db = await dbPromise;
  const stored = db
    .prepare(
      `SELECT avatar_blob AS avatarBlob, avatar_mime AS avatarMime,
       avatar_url AS avatarUrl, avatar_version AS avatarVersion
       FROM users WHERE id = ?`,
    )
    .get(userId) as {
      avatarBlob: Buffer;
      avatarMime: string;
      avatarUrl: string;
      avatarVersion: number;
    };
  assert.ok(stored.avatarBlob.length > 0);
  assert.ok(stored.avatarMime === "image/jpeg" || stored.avatarMime === "image/webp");
  assert.equal(stored.avatarUrl, `/api/v1/avatars/${userId}?v=1`);
  assert.equal(stored.avatarVersion, 1);
  assert.equal(
    (db.prepare("SELECT action FROM audit_logs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 1").get(userId) as { action: string }).action,
    "PROFILE_AVATAR_UPDATE",
  );
  assert.equal(JSON.stringify(payload).includes("avatarBlob"), false);
});

test("POST /auth/avatar rejects a declared MIME type that disagrees with image magic", async () => {
  const { userId, token } = await member();
  const { POST } = await uploadRoutePromise;
  const response = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: pngBytes.toString("base64"), mimeType: "image/jpeg" },
  ));
  const payload = await responseBody(response);

  assert.equal(response.status, 422);
  assert.equal(payload.error, "AVATAR_TYPE_MISMATCH");
  const db = await dbPromise;
  const stored = db
    .prepare("SELECT avatar_blob AS avatarBlob, avatar_version AS avatarVersion FROM users WHERE id = ?")
    .get(userId) as { avatarBlob: Buffer | null; avatarVersion: number };
  assert.equal(stored.avatarBlob, null);
  assert.equal(stored.avatarVersion, 0);
});

test("GET /avatars/:userId returns cached image bytes and honors ETag", async () => {
  const { userId, token } = await member();
  const { POST } = await uploadRoutePromise;
  const uploadResponse = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: pngBytes.toString("base64"), mimeType: "image/png" },
  ));
  const signedAvatarUrl = avatarUrlFromPayload(await responseBody(uploadResponse));

  const { GET } = await avatarRoutePromise;
  const context = { params: Promise.resolve({ userId }) };
  const response = await GET(
    new Request(`http://localhost${signedAvatarUrl}`) as never,
    context,
  );
  const db = await dbPromise;
  const stored = db
    .prepare("SELECT avatar_blob AS avatarBlob, avatar_mime AS avatarMime FROM users WHERE id = ?")
    .get(userId) as { avatarBlob: Buffer; avatarMime: string };

  const unsigned = await GET(
    new Request(`http://localhost/api/v1/avatars/${userId}?v=1`) as never,
    context,
  );
  assert.equal(unsigned.status, 404);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), stored.avatarMime);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-cache, max-age=0, must-revalidate",
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), stored.avatarBlob);

  const etag = response.headers.get("etag");
  assert.ok(etag);
  const conditional = await GET(
    new Request(`http://localhost${signedAvatarUrl}`, {
      headers: { "if-none-match": etag },
    }) as never,
    context,
  );
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");

  const wrongVersion = await GET(
    new Request(`http://localhost${signedAvatarUrl.replace("v=1", "v=999")}`) as never,
    context,
  );
  assert.equal(wrongVersion.status, 404);
  assert.match(wrongVersion.headers.get("cache-control") || "", /no-store/);
});

test("avatar capabilities reject invalid, expired, removed and superseded URLs with admin-only fallback", async () => {
  const { userId, token } = await member();
  const { POST } = await uploadRoutePromise;
  const uploadResponse = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: pngBytes.toString("base64"), mimeType: "image/png" },
  ));
  const validUrl = avatarUrlFromPayload(await responseBody(uploadResponse));
  const { GET } = await avatarRoutePromise;
  const context = { params: Promise.resolve({ userId }) };

  const invalidUrl = new URL(`http://localhost${validUrl}`);
  const signature = invalidUrl.searchParams.get("sig") || "";
  invalidUrl.searchParams.set("sig", `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`);
  assert.equal((await GET(new Request(invalidUrl) as never, context)).status, 404);

  const expiredUrl = signedUrlFor(userId, 1, Math.floor(Date.now() / 1_000) - 1);
  assert.equal(
    (await GET(new Request(`http://localhost${expiredUrl}`) as never, context)).status,
    404,
  );

  const db = await dbPromise;
  db.prepare(
    `UPDATE users SET avatar_version = 2,
     avatar_url = '/api/v1/avatars/' || id || '?v=2' WHERE id = ?`,
  ).run(userId);
  assert.equal(
    (await GET(new Request(`http://localhost${validUrl}`) as never, context)).status,
    404,
  );

  const currentUrl = signedUrlFor(userId, 2, Math.floor(Date.now() / 1_000) + 900);
  assert.equal(
    (await GET(new Request(`http://localhost${currentUrl}`) as never, context)).status,
    200,
  );
  db.prepare("UPDATE users SET avatar_blob = NULL, avatar_mime = NULL WHERE id = ?").run(userId);
  assert.equal(
    (await GET(new Request(`http://localhost${currentUrl}`) as never, context)).status,
    404,
  );

  db.prepare(
    `UPDATE users SET avatar_blob = ?, avatar_mime = 'image/png', avatar_version = 3,
     avatar_url = '/api/v1/avatars/' || id || '?v=3' WHERE id = ?`,
  ).run(pngBytes, userId);
  const { createSessionToken } = await authPromise;
  const adminToken = await createSessionToken({ userId: "system-admin", scope: "admin" });
  const adminUrl = `http://localhost/api/v1/avatars/${userId}?v=3`;
  const adminResponse = await GET(new Request(adminUrl, {
    headers: {
      cookie: `codepool_admin=${adminToken}`,
      "sec-fetch-site": "same-origin",
    },
  }) as never, context);
  assert.equal(adminResponse.status, 200);

  const crossSiteAdmin = await GET(new Request(adminUrl, {
    headers: {
      cookie: `codepool_admin=${adminToken}`,
      "sec-fetch-site": "cross-site",
    },
  }) as never, context);
  assert.equal(crossSiteAdmin.status, 404);
});

test("member profile, team member and audit APIs emit signed avatar capabilities", async () => {
  const { userId, token } = await member();
  const { POST } = await uploadRoutePromise;
  await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: pngBytes.toString("base64"), mimeType: "image/png" },
  ));
  const db = await dbPromise;
  const teamId = randomUUID();
  db.prepare("INSERT INTO teams(id, name, slug, owner_id) VALUES (?, ?, ?, ?)").run(
    teamId,
    "签名头像团队",
    `signed-${teamId.slice(0, 12)}`,
    userId,
  );
  db.prepare("INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, 'owner')").run(
    teamId,
    userId,
  );
  db.prepare(
    `INSERT INTO audit_logs(id, team_id, actor_id, action, target_type, target_id)
     VALUES (?, ?, ?, 'PROFILE_UPDATE', 'user', ?)`,
  ).run(randomUUID(), teamId, userId, userId);

  const capabilityPattern = new RegExp(
    `^/api/v1/avatars/${userId}\\?v=1&exp=\\d{10}&sig=[A-Za-z0-9_-]{43}$`,
  );
  const { GET: getMe } = await meRoutePromise;
  const mePayload = await responseBody(await getMe(authenticatedGetRequest("/api/v1/auth/me", token)));
  assert.match((mePayload.data?.user as { avatarUrl: string }).avatarUrl, capabilityPattern);

  const { GET: getMembers } = await teamMembersRoutePromise;
  const membersResponse = await getMembers(
    authenticatedGetRequest(`/api/v1/teams/${teamId}/members`, token),
    { params: Promise.resolve({ teamId }) },
  );
  const membersPayload = await membersResponse.json() as {
    data: Array<{ userId: string; avatarUrl: string; avatarVersion?: number }>;
  };
  assert.match(membersPayload.data[0].avatarUrl, capabilityPattern);
  assert.equal(membersPayload.data[0].avatarVersion, undefined);

  const { GET: getAuditLogs } = await auditLogsRoutePromise;
  const auditResponse = await getAuditLogs(authenticatedGetRequest(
    `/api/v1/audit/logs?teamId=${teamId}`,
    token,
  ));
  const auditPayload = await auditResponse.json() as {
    data: Array<{ actorAvatar: string; actorAvatarVersion?: number }>;
  };
  assert.match(auditPayload.data[0].actorAvatar, capabilityPattern);
  assert.equal(auditPayload.data[0].actorAvatarVersion, undefined);
});

test("POST /auth/avatar rejects corrupt and oversized decoded images", async () => {
  const { token } = await member();
  const { POST } = await uploadRoutePromise;
  const corrupt = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const corruptResponse = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: corrupt.toString("base64"), mimeType: "image/png" },
  ));
  assert.equal(corruptResponse.status, 422);
  assert.equal((await responseBody(corruptResponse)).error, "INVALID_AVATAR_IMAGE");

  const oversized = await sharp({
    create: { width: 5_000, height: 5_000, channels: 3, background: "#ffffff" },
  }).png().toBuffer();
  assert.ok(oversized.length < 512 * 1024);
  const oversizedResponse = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: oversized.toString("base64"), mimeType: "image/png" },
  ));
  assert.equal(oversizedResponse.status, 422);
  assert.equal((await responseBody(oversizedResponse)).error, "INVALID_AVATAR_IMAGE");
});

test("POST /auth/avatar rejects animated WebP images", async () => {
  const { token } = await member();
  const red = Buffer.alloc(2 * 2 * 4);
  const blue = Buffer.alloc(2 * 2 * 4);
  for (let offset = 0; offset < red.length; offset += 4) {
    red[offset] = 255;
    red[offset + 3] = 255;
    blue[offset + 2] = 255;
    blue[offset + 3] = 255;
  }
  const animated = await sharp(Buffer.concat([red, blue]), {
    raw: { width: 2, height: 4, pageHeight: 2, channels: 4 },
  }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  const { POST } = await uploadRoutePromise;
  const response = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: animated.toString("base64"), mimeType: "image/webp" },
  ));

  assert.equal(response.status, 422);
  assert.equal((await responseBody(response)).error, "ANIMATED_AVATAR_UNSUPPORTED");
});

test("POST /auth/avatar normalizes orientation, dimensions, metadata and encoding", async () => {
  const { userId, token } = await member();
  const source = await sharp({
    create: { width: 800, height: 400, channels: 3, background: "#23855b" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const { POST } = await uploadRoutePromise;
  const response = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: source.toString("base64"), mimeType: "image/jpeg" },
  ));
  assert.equal(response.status, 200);

  const db = await dbPromise;
  const stored = db.prepare("SELECT avatar_blob AS avatarBlob FROM users WHERE id = ?").get(userId) as {
    avatarBlob: Buffer;
  };
  const metadata = await sharp(stored.avatarBlob).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test("disabled users cannot update profiles or expose stored avatars", async () => {
  const { userId, token } = await member();
  const db = await dbPromise;
  db.prepare(
    `UPDATE users SET avatar_blob = ?, avatar_mime = 'image/png', avatar_version = 1,
     avatar_url = '/api/v1/avatars/' || id || '?v=1', status = 'disabled',
     session_version = session_version + 1 WHERE id = ?`,
  ).run(pngBytes, userId);

  const { PATCH } = await meRoutePromise;
  const patchResponse = await PATCH(authenticatedJsonRequest(
    "/api/v1/auth/me",
    token,
    { nickname: "不应写入" },
    "PATCH",
  ));
  assert.equal(patchResponse.status, 401);

  const { POST } = await uploadRoutePromise;
  const uploadResponse = await POST(authenticatedJsonRequest(
    "/api/v1/auth/avatar",
    token,
    { data: pngBytes.toString("base64"), mimeType: "image/png" },
  ));
  assert.equal(uploadResponse.status, 401);

  const { GET } = await avatarRoutePromise;
  const avatarResponse = await GET(
    new Request(`http://localhost/api/v1/avatars/${userId}?v=1`) as never,
    { params: Promise.resolve({ userId }) },
  );
  assert.equal(avatarResponse.status, 404);
  assert.equal(
    (db.prepare("SELECT nickname FROM users WHERE id = ?").get(userId) as { nickname: string }).nickname,
    "测试用户",
  );
});

test("session version changes invalidate profile writes before the transaction", async () => {
  const { userId, token } = await member();
  const db = await dbPromise;
  db.prepare("UPDATE users SET session_version = session_version + 1 WHERE id = ?").run(userId);

  const { PATCH } = await meRoutePromise;
  const response = await PATCH(authenticatedJsonRequest(
    "/api/v1/auth/me",
    token,
    { nickname: "不应写入" },
    "PATCH",
  ));
  assert.equal(response.status, 401);
});
