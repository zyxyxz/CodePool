import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.CODEPOOL_SMOKE_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const runId = randomUUID().slice(0, 12);
const forwardedIp = `198.51.100.${Number.parseInt(runId.slice(0, 2), 16) % 200 + 1}`;

async function call(path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-forwarded-for", forwardedIp);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { response, body };
}

function bearer(token) {
  return { authorization: `Bearer ${token}` };
}

function expectStatus(result, expected, label) {
  assert.equal(
    result.response.status,
    expected,
    `${label}: expected ${expected}, received ${result.response.status} (${JSON.stringify(result.body)})`,
  );
}

async function login(suffix) {
  const result = await call("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ wx_code: `security-smoke-${runId}-${suffix}`, nickname: `Smoke ${suffix}` }),
  });
  expectStatus(result, 201, `login ${suffix}`);
  assert.match(result.response.headers.get("cache-control") || "", /no-store/);
  return {
    token: result.body.data.accessToken,
    userId: result.body.data.user.id,
    teamId: result.body.data.user.teams[0].teamId,
  };
}

async function main() {
  const health = await call("/api/health");
  expectStatus(health, 200, "health");
  assert.match(health.response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  assert.equal(health.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(health.response.headers.get("x-frame-options"), "DENY");
  assert.ok(health.response.headers.get("strict-transport-security"));

  const publicConfig = await call("/api/v1/config");
  expectStatus(publicConfig, 200, "public platform config");
  assert.equal(publicConfig.body.data.workspaceName, "CodePool");
  for (const sensitiveKey of ["jwtSecret", "masterKey", "adminPassword", "wechatAppSecret"]) {
    assert.equal(sensitiveKey in publicConfig.body.data, false, `public config leaked ${sensitiveKey}`);
  }

  const invalidSession = await call("/api/v1/auth/me", {
    headers: bearer("not-a-valid-jwt"),
  });
  expectStatus(invalidSession, 401, "invalid JWT is an authentication failure");

  const oversizedPayload = JSON.stringify({ wx_code: "x".repeat(300 * 1024) });
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversizedPayload));
      controller.close();
    },
  });
  const oversized = await call("/api/v1/auth/login", {
    method: "POST",
    // The server intentionally cancels the unread remainder when rejecting an
    // oversized chunked body. Do not let undici reuse that HTTP/1.1 socket for
    // the next assertion; Linux can otherwise surface the close as ECONNRESET
    // on an unrelated request.
    headers: { connection: "close" },
    body: oversizedStream,
    duplex: "half",
  });
  expectStatus(oversized, 413, "chunked oversized body");

  const owner = await login("owner");
  const createdItem = await call("/api/v1/items", {
    method: "POST",
    headers: bearer(owner.token),
    body: JSON.stringify({
      teamId: owner.teamId,
      kind: "secret",
      title: "Smoke secret",
      content: `commercial-secret-${runId}`,
      metadata: { internal: "must-not-appear-in-preview" },
    }),
  });
  expectStatus(createdItem, 201, "create item");
  const itemId = createdItem.body.data.id;

  const createdShare = await call("/api/v1/shares", {
    method: "POST",
    headers: bearer(owner.token),
    body: JSON.stringify({ itemId, expiresInSec: 300, maxViews: 1 }),
  });
  expectStatus(createdShare, 201, "create share");
  assert.match(createdShare.response.headers.get("cache-control") || "", /no-store/);
  const shareToken = createdShare.body.data.token;

  const preview = await call(`/api/v1/shares/public/${encodeURIComponent(shareToken)}`);
  expectStatus(preview, 200, "share preview");
  for (const sensitiveKey of ["content", "secret", "code", "metadata", "identifier", "cipher_text", "iv", "auth_tag"]) {
    assert.equal(sensitiveKey in preview.body.data, false, `preview leaked ${sensitiveKey}`);
  }
  assert.match(preview.response.headers.get("cache-control") || "", /no-store/);

  const head = await call(`/api/v1/shares/public/${encodeURIComponent(shareToken)}`, { method: "HEAD" });
  expectStatus(head, 204, "share HEAD");
  const previewAfterHead = await call(`/api/v1/shares/public/${encodeURIComponent(shareToken)}`);
  expectStatus(previewAfterHead, 200, "share preview after HEAD");

  const claims = await Promise.all([
    call(`/api/v1/shares/public/${encodeURIComponent(shareToken)}`, { method: "POST" }),
    call(`/api/v1/shares/public/${encodeURIComponent(shareToken)}`, { method: "POST" }),
  ]);
  assert.deepEqual(
    claims.map((entry) => entry.response.status).sort((a, b) => a - b),
    [200, 410],
    "single-view share must be claimed exactly once",
  );
  const successfulClaim = claims.find((entry) => entry.response.status === 200);
  assert.equal(successfulClaim.body.data.content, `commercial-secret-${runId}`);
  assert.match(successfulClaim.response.headers.get("cache-control") || "", /no-store/);

  const member = await login("member");
  const createdInvite = await call(`/api/v1/teams/${owner.teamId}/invites`, {
    method: "POST",
    headers: bearer(owner.token),
    body: JSON.stringify({ role: "member", expiresInHours: 1 }),
  });
  expectStatus(createdInvite, 201, "create invite");
  const inviteToken = createdInvite.body.data.token;
  const accepts = await Promise.all([
    call(`/api/v1/teams/invites/${encodeURIComponent(inviteToken)}/accept`, {
      method: "POST",
      headers: bearer(member.token),
    }),
    call(`/api/v1/teams/invites/${encodeURIComponent(inviteToken)}/accept`, {
      method: "POST",
      headers: bearer(member.token),
    }),
  ]);
  assert.deepEqual(
    accepts.map((entry) => entry.response.status).sort((a, b) => a - b),
    [200, 410],
    "invite must be accepted exactly once",
  );

  const revocableShare = await call("/api/v1/shares", {
    method: "POST",
    headers: bearer(owner.token),
    body: JSON.stringify({ itemId, expiresInSec: 300, maxViews: 2 }),
  });
  expectStatus(revocableShare, 201, "create revocable share");
  const revocableShareId = revocableShare.body.data.id;
  const revocableToken = revocableShare.body.data.token;
  const ownerShares = await call(`/api/v1/shares?itemId=${itemId}`, {
    headers: bearer(owner.token),
  });
  expectStatus(ownerShares, 200, "owner share list");
  assert.equal(
    ownerShares.body.data.find((entry) => entry.id === revocableShareId).canRevoke,
    true,
  );
  const memberShares = await call(`/api/v1/shares?itemId=${itemId}`, {
    headers: bearer(member.token),
  });
  expectStatus(memberShares, 200, "member share list");
  assert.equal(
    memberShares.body.data.find((entry) => entry.id === revocableShareId).canRevoke,
    false,
  );
  const unauthorizedRevoke = await call(`/api/v1/shares/${revocableShareId}`, {
    method: "DELETE",
    headers: bearer(member.token),
  });
  expectStatus(unauthorizedRevoke, 403, "member cannot revoke another user's share");
  const revoke = await call(`/api/v1/shares/${revocableShareId}`, {
    method: "DELETE",
    headers: bearer(owner.token),
  });
  expectStatus(revoke, 200, "share creator revoke");
  assert.equal(revoke.body.data.alreadyRevoked, false);
  assert.ok(revoke.body.data.revokedAt);
  assert.match(revoke.response.headers.get("cache-control") || "", /no-store/);
  const previewAfterRevoke = await call(
    `/api/v1/shares/public/${encodeURIComponent(revocableToken)}`,
  );
  expectStatus(previewAfterRevoke, 410, "revoked share preview");
  const repeatedRevoke = await call(`/api/v1/shares/${revocableShareId}`, {
    method: "DELETE",
    headers: bearer(owner.token),
  });
  expectStatus(repeatedRevoke, 200, "idempotent share revoke");
  assert.equal(repeatedRevoke.body.data.alreadyRevoked, true);
  assert.equal(repeatedRevoke.body.data.revokedAt, revoke.body.data.revokedAt);

  const deletion = await call("/api/v1/auth/deletion-request", {
    method: "POST",
    headers: bearer(member.token),
    body: JSON.stringify({ note: "security smoke" }),
  });
  expectStatus(deletion, 201, "create deletion request");
  assert.equal(deletion.body.data.created, true);
  const duplicateDeletion = await call("/api/v1/auth/deletion-request", {
    method: "POST",
    headers: bearer(member.token),
    body: JSON.stringify({}),
  });
  expectStatus(duplicateDeletion, 200, "idempotent deletion request");
  assert.equal(duplicateDeletion.body.data.created, false);
  assert.equal(duplicateDeletion.body.data.request.id, deletion.body.data.request.id);
  const withdrawal = await call("/api/v1/auth/deletion-request", {
    method: "DELETE",
    headers: bearer(member.token),
  });
  expectStatus(withdrawal, 200, "withdraw deletion request");
  assert.equal(withdrawal.body.data.cancelled, true);
  assert.equal(withdrawal.body.data.request.status, "cancelled");

  if (process.env.CODEPOOL_SMOKE_SKIP_ADMIN !== "true") {
    const disabledUser = await login("disabled");
    const deletionTarget = await login("deletion-complete");
    const deletionRequest = await call("/api/v1/auth/deletion-request", {
      method: "POST",
      headers: bearer(deletionTarget.token),
      body: JSON.stringify({ note: "complete this isolated account" }),
    });
    expectStatus(deletionRequest, 201, "create completable deletion request");
    const adminLogin = await call("/api/admin/login", {
      method: "POST",
      headers: { origin: baseUrl },
      body: JSON.stringify({
        email: process.env.CODEPOOL_ADMIN_EMAIL || "admin@codepool.local",
        password: process.env.CODEPOOL_ADMIN_PASSWORD || "codepool-dev-only",
      }),
    });
    expectStatus(adminLogin, 200, "admin login for disable test");
    const adminCookie = (adminLogin.response.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(adminCookie.startsWith("codepool_admin="), "admin login did not set a session cookie");
    const maintenanceOn = await call("/api/admin/settings", {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ maintenanceMode: true }),
    });
    expectStatus(maintenanceOn, 200, "enable maintenance mode");
    const maintenanceConfig = await call("/api/v1/config");
    expectStatus(maintenanceConfig, 200, "maintenance public config");
    assert.equal(maintenanceConfig.body.data.maintenanceMode, true);
    const blockedUpdate = await call(`/api/v1/items/${itemId}`, {
      method: "PATCH",
      headers: bearer(owner.token),
      body: JSON.stringify({ title: "must not update during maintenance" }),
    });
    expectStatus(blockedUpdate, 503, "maintenance blocks member edits");
    assert.equal(blockedUpdate.body.error, "MAINTENANCE_MODE");
    const maintenanceOff = await call("/api/admin/settings", {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ maintenanceMode: false }),
    });
    expectStatus(maintenanceOff, 200, "disable maintenance mode");
    const approveDeletion = await call(`/api/admin/deletion-requests/${deletionRequest.body.data.request.id}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ status: "approved", note: "identity verified" }),
    });
    expectStatus(approveDeletion, 200, "approve deletion request");
    const completeDeletion = await call(`/api/admin/deletion-requests/${deletionRequest.body.data.request.id}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ status: "completed", note: "retention policy applied" }),
    });
    expectStatus(completeDeletion, 200, "complete isolated account deletion");
    assert.ok(completeDeletion.body.data.autoDisabledTeams >= 1, "personal team must be archived");
    const deletedSession = await call("/api/v1/auth/me", { headers: bearer(deletionTarget.token) });
    expectStatus(deletedSession, 401, "completed deletion revokes member session");
    const archivedTeam = await call(`/api/admin/teams/${deletionTarget.teamId}`, {
      headers: { cookie: adminCookie },
    });
    expectStatus(archivedTeam, 200, "archived personal team detail");
    assert.equal(Boolean(archivedTeam.body.data.team.canRestore), false);
    assert.equal(archivedTeam.body.data.team.eligibleOwnerCount, 0);
    const restoreDeleted = await call(`/api/admin/users/${deletionTarget.userId}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ status: "active" }),
    });
    expectStatus(restoreDeleted, 409, "completed account cannot be restored");
    const restoreArchivedTeam = await call(`/api/admin/teams/${deletionTarget.teamId}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ status: "active" }),
    });
    expectStatus(restoreArchivedTeam, 422, "archived team cannot be restored under deleted owner");
    const disabled = await call(`/api/admin/users/${disabledUser.userId}`, {
      method: "PATCH",
      headers: { cookie: adminCookie, origin: baseUrl },
      body: JSON.stringify({ status: "disabled", reason: "security smoke" }),
    });
    expectStatus(disabled, 200, "disable member");
    const revokedSession = await call("/api/v1/auth/me", { headers: bearer(disabledUser.token) });
    expectStatus(revokedSession, 401, "disabled member session revocation");
    const disabledLogin = await call("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({
        wx_code: `security-smoke-${runId}-disabled`,
        nickname: "Disabled smoke",
      }),
    });
    expectStatus(disabledLogin, 403, "disabled member login");
    assert.equal(disabledLogin.body.error, "USER_DISABLED");
  }

  let limited = null;
  for (let index = 0; index < 35; index += 1) {
    const result = await call(`/api/v1/shares/public/invalid-${runId}-${index}`, { method: "POST" });
    if (result.response.status === 429) {
      limited = result;
      break;
    }
  }
  assert.ok(limited, "share redemption should eventually be rate limited");
  assert.ok(Number(limited.response.headers.get("retry-after")) >= 1, "429 must include Retry-After");

  let headLimited = null;
  for (let index = 0; index < 125; index += 1) {
    const result = await call(`/api/v1/shares/public/head-invalid-${runId}`, { method: "HEAD" });
    if (result.response.status === 429) {
      headLimited = result;
      break;
    }
  }
  assert.ok(headLimited, "share HEAD preview should eventually be rate limited");
  assert.ok(Number(headLimited.response.headers.get("retry-after")) >= 1, "HEAD 429 must include Retry-After");

  console.log("CodePool member security smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
