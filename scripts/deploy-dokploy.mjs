const apiKey = process.env.DOKPLOY_API_KEY || "";
const apiBase = (process.env.DOKPLOY_API_URL || "").replace(/\/$/, "");
const applicationId = process.env.DOKPLOY_APPLICATION_ID || "";
const productionUrl = (process.env.CODEPOOL_PRODUCTION_URL || "").replace(/\/$/, "");
const commitSha = process.env.DEPLOY_COMMIT_SHA || "";
const runId = process.env.DEPLOY_RUN_ID || "unknown";

for (const [name, value] of Object.entries({
  DOKPLOY_API_KEY: apiKey,
  DOKPLOY_API_URL: apiBase,
  DOKPLOY_APPLICATION_ID: applicationId,
  CODEPOOL_PRODUCTION_URL: productionUrl,
  DEPLOY_COMMIT_SHA: commitSha,
})) {
  if (!value) throw new Error(`${name} is required`);
}
if (!apiBase.startsWith("https://") || !productionUrl.startsWith("https://")) {
  throw new Error("Deployment and production URLs must use HTTPS");
}

const title = `CI verified ${commitSha.slice(0, 7)} (run ${runId})`;
const description = `Commit: ${commitSha} | CI: ${runId}`;
const requestedAt = Date.now();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function dokploy(path, init = {}) {
  const response = await fetch(`${apiBase}/api/${path}`, {
    ...init,
    signal: AbortSignal.timeout(30_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      ...init.headers,
    },
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; }
  }
  if (!response.ok) {
    throw new Error(`Dokploy ${path} failed with ${response.status}: ${JSON.stringify(body).slice(0, 700)}`);
  }
  return body;
}

function deploymentRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.deployments)) return payload.deployments;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function currentDeployments() {
  const payload = await dokploy(`deployment.all?applicationId=${encodeURIComponent(applicationId)}`);
  return deploymentRows(payload);
}

async function assertIdle() {
  const application = await dokploy(`application.one?applicationId=${encodeURIComponent(applicationId)}`);
  if (application?.sourceType !== "git" || application?.customGitBranch !== "production" || application?.autoDeploy !== false) {
    throw new Error("Dokploy must use the production branch with autoDeploy disabled");
  }
  const active = (await currentDeployments()).filter((entry) => ["queued", "running"].includes(entry.status));
  if (active.length) {
    throw new Error(`Dokploy already has an active deployment: ${active.map((entry) => entry.deploymentId).join(", ")}`);
  }
  return application;
}

let deploymentQueued = false;
let cleanupStarted = false;

async function cancelOutstandingDeployment() {
  if (!deploymentQueued || cleanupStarted) return;
  cleanupStarted = true;
  for (const path of ["application.cancelDeployment", "application.cleanQueues"]) {
    try {
      await dokploy(path, {
        method: "POST",
        body: JSON.stringify({ applicationId }),
      });
    } catch (error) {
      console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function deploy() {
  const application = await assertIdle();
  const buildArgs = String(application?.buildArgs || "")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("CODEPOOL_COMMIT_SHA="));
  buildArgs.push(`CODEPOOL_COMMIT_SHA=${commitSha}`);
  await dokploy("application.update", {
    method: "POST",
    body: JSON.stringify({ applicationId, buildArgs: buildArgs.join("\n") }),
  });

  const queued = await dokploy("application.deploy", {
    method: "POST",
    body: JSON.stringify({ applicationId, title, description }),
  });
  deploymentQueued = true;
  const queuedId = typeof queued === "string" ? queued : queued?.deploymentId || queued?.id;
  console.log(`Dokploy accepted verified commit ${commitSha.slice(0, 12)}.`);

  let deployment;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    deployment = (await currentDeployments())
      .filter((entry) => {
        if (queuedId && entry.deploymentId === queuedId) return true;
        const createdAt = new Date(entry.createdAt || 0).getTime();
        return createdAt >= requestedAt - 5_000 && entry.title === title;
      })
      .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))[0];

    if (deployment?.status === "done") break;
    if (deployment && ["error", "cancelled"].includes(deployment.status)) {
      throw new Error(`Dokploy deployment ${deployment.deploymentId} ended with ${deployment.status}`);
    }
    await delay(5_000);
  }

  if (deployment?.status !== "done") {
    throw new Error("Dokploy deployment did not finish within 8 minutes");
  }
  deploymentQueued = false;
  console.log(`Dokploy deployment ${deployment.deploymentId} completed.`);

  let health;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${productionUrl}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json();
      if (
        response.ok &&
        payload?.data?.status === "ok" &&
        payload?.data?.database === "ready" &&
        payload?.data?.commit === commitSha
      ) {
        health = payload.data;
        break;
      }
    } catch {
      // A rolling deployment can briefly close the previous connection.
    }
    await delay(3_000);
  }

  if (!health) throw new Error(`Production did not report verified commit ${commitSha.slice(0, 12)} after deployment`);
  console.log(`Production is healthy at ${health.commit.slice(0, 12)} (${health.service} ${health.version}, database ${health.database}).`);
}

if (process.argv.includes("--preflight")) {
  await assertIdle();
  console.log("Dokploy release queue is idle and production branch deployment is enforced.");
} else {
  process.once("SIGTERM", () => {
    cancelOutstandingDeployment().finally(() => process.exit(143));
  });
  try {
    await deploy();
  } catch (error) {
    await cancelOutstandingDeployment();
    throw error;
  }
}
