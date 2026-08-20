import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testDirectory = mkdtempSync(join(tmpdir(), "codepool-wechat-login-"));
const loginCode = "sensitive-login-code";
const appSecret = "sensitive-app-secret-for-tests";

process.env.CODEPOOL_DATABASE_PATH = join(testDirectory, "codepool.db");
process.env.WECHAT_APP_ID = "wx-test-app-id";
process.env.WECHAT_APP_SECRET = appSecret;
process.env.WECHAT_MOCK_LOGIN = "false";

const routePromise = import("../src/app/api/v1/auth/login/route");
const dbPromise = import("../src/server/db").then((module) => module.db);

test.after(() => {
  rmSync(testDirectory, { recursive: true, force: true });
});

type UpstreamResult = {
  status: number;
  body: Record<string, unknown>;
  logs: string;
};

async function requestWithUpstream(upstream: () => Promise<Response>): Promise<UpstreamResult> {
  const { POST } = await routePromise;
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logged: unknown[][] = [];
  globalThis.fetch = upstream;
  console.error = (...values: unknown[]) => {
    logged.push(values);
  };

  try {
    const response = await POST(new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wx_code: loginCode }),
    }) as never);
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
      logs: JSON.stringify(logged),
    };
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
}

function wechatResponse(payload: Record<string, unknown>, status = 200) {
  return async () => new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function assertSafeLogs(logs: string, errcode: number | null, rid: string | null) {
  assert.equal(logs.includes(loginCode), false);
  assert.equal(logs.includes(appSecret), false);
  assert.match(logs, new RegExp(`\\"errcode\\":${errcode === null ? "null" : errcode}`));
  assert.match(logs, new RegExp(`\\"rid\\":${rid === null ? "null" : `\\"${rid}\\"`}`));
}

test("maps an expired WeChat code to a stable retryable authentication error", async () => {
  const result = await requestWithUpstream(wechatResponse({
    errcode: 40029,
    errmsg: "invalid code, rid: code-rid",
  }));

  assert.equal(result.status, 401);
  assert.equal(result.body.error, "WECHAT_CODE_INVALID");
  assertSafeLogs(result.logs, 40029, "code-rid");
});

for (const errcode of [40125, 40164]) {
  test(`maps WeChat configuration error ${errcode} to a stable service error`, async () => {
    const result = await requestWithUpstream(wechatResponse({
      errcode,
      errmsg: `configuration rejected, rid: config-${errcode}`,
    }));

    assert.equal(result.status, 503);
    assert.equal(result.body.error, "WECHAT_CONFIGURATION_ERROR");
    assertSafeLogs(result.logs, errcode, `config-${errcode}`);
  });
}

test("maps WeChat system busy to an upstream unavailable error", async () => {
  const result = await requestWithUpstream(wechatResponse({
    errcode: -1,
    errmsg: "system error, rid: busy-rid",
  }));

  assert.equal(result.status, 503);
  assert.equal(result.body.error, "WECHAT_UPSTREAM_UNAVAILABLE");
  assertSafeLogs(result.logs, -1, "busy-rid");
});

test("maps network failures without logging sensitive upstream error text", async () => {
  const result = await requestWithUpstream(async () => {
    throw new Error(`network failure for ${loginCode} using ${appSecret}`);
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.error, "WECHAT_UPSTREAM_UNAVAILABLE");
  assertSafeLogs(result.logs, null, null);
});

test("returns a signed avatar capability for an existing member", async () => {
  const db = await dbPromise;
  const userId = "5c9a9581-e426-46cf-9b27-9311e731adce";
  const openId = "signed-avatar-existing-user";
  db.prepare(
    `INSERT INTO users(
       id, open_id, nickname, avatar_url, avatar_blob, avatar_mime, avatar_version
     ) VALUES (?, ?, '头像用户', ?, ?, 'image/png', 1)`,
  ).run(
    userId,
    openId,
    `/api/v1/avatars/${userId}?v=1`,
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  );
  const result = await requestWithUpstream(wechatResponse({ openid: openId }));

  assert.equal(result.status, 201);
  const data = result.body.data as { user: { avatarUrl: string; avatarVersion?: number } };
  assert.match(
    data.user.avatarUrl,
    new RegExp(`^/api/v1/avatars/${userId}\\?v=1&exp=\\d{10}&sig=[A-Za-z0-9_-]{43}$`),
  );
  assert.equal(data.user.avatarVersion, undefined);
});
