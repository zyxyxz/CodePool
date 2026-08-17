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

async function dokploy(path, init = {}, timeoutMilliseconds = 30_000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${apiBase}/api/${path}`, {
    ...init,
    signal,
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

async function currentQueueJobs() {
  return deploymentRows(await dokploy("deployment.queueList"));
}

function pendingQueueJobsForApplication(rows) {
  return rows.filter((entry) => {
    const state = String(entry?.state || "");
    return entry?.data?.applicationId === applicationId && !["completed", "failed"].includes(state);
  });
}

function deploymentMatchesRelease(entry, queuedId = "") {
  if (queuedId && entry?.deploymentId === queuedId) return true;
  const createdAt = new Date(entry?.createdAt || 0).getTime();
  const entryDescription = String(entry?.description || "");
  // Dokploy starts with our CI metadata, then replaces it with cloned commit
  // metadata for generic Git sources. Accept either representation.
  return createdAt >= requestedAt - 5_000 && (
    entry?.title === title ||
    entryDescription === description ||
    entryDescription.includes(commitSha)
  );
}

function newestReleaseDeployment(rows, queuedId = "") {
  return rows
    .filter((entry) => deploymentMatchesRelease(entry, queuedId))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))[0];
}

async function assertIdle() {
  const application = await dokploy(`application.one?applicationId=${encodeURIComponent(applicationId)}`);
  if (application?.sourceType !== "git" || application?.customGitBranch !== "production" || application?.autoDeploy !== false) {
    throw new Error("Dokploy must use the production branch with autoDeploy disabled");
  }
  const [deployments, queueJobs] = await Promise.all([currentDeployments(), currentQueueJobs()]);
  const active = deployments.filter((entry) => entry.status === "running");
  const pending = pendingQueueJobsForApplication(queueJobs);
  if (active.length || pending.length) {
    const ids = [
      ...active.map((entry) => `deployment:${entry.deploymentId}`),
      ...pending.map((entry) => `queue:${entry.id || "unknown"}:${entry.state || "unknown"}`),
    ];
    throw new Error(`Dokploy already has an active or queued deployment: ${ids.join(", ")}`);
  }
  return application;
}

let deploymentRequested = false;
let cleanupPromise;
let deployRequestController;
let deployRequestPromise;
let trackedDeploymentId = "";

async function cleanupRequest(path, init = {}) {
  return dokploy(path, init, 2_000);
}

async function performOutstandingDeploymentCleanup() {
  const pendingDeployRequest = deployRequestPromise;
  deployRequestController?.abort();
  if (pendingDeployRequest) {
    try {
      await pendingDeployRequest;
    } catch {
      // The expected path when an in-flight enqueue request is aborted.
    }
  }

  // Self-hosted Dokploy cannot cancel an active application deployment through
  // its public API. Remove waiting work and fail closed if an active process
  // does not reach a terminal state within the cleanup window.
  try {
    await cleanupRequest("application.cleanQueues", {
      method: "POST",
      body: JSON.stringify({ applicationId }),
    });
  } catch (error) {
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  }

  let quietSince = 0;
  const cleanupDeadline = Date.now() + 7_000;
  while (Date.now() < cleanupDeadline) {
    let deployments;
    let queueJobs;
    try {
      // Read the queue first. Once an active job disappears from the queue,
      // its deployment row has already been created and will be visible here.
      queueJobs = deploymentRows(await cleanupRequest("deployment.queueList"));
      if (pendingQueueJobsForApplication(queueJobs).length) {
        // A request that raced the initial cleanup may have arrived late.
        // Observe it first (resetting the quiet window), then remove it if it
        // is still waiting. Active jobs remain visible until terminal.
        await cleanupRequest("application.cleanQueues", {
          method: "POST",
          body: JSON.stringify({ applicationId }),
        });
      }
      deployments = deploymentRows(await cleanupRequest(
        `deployment.all?applicationId=${encodeURIComponent(applicationId)}`,
      ));
    } catch (error) {
      throw new Error(`Could not inspect Dokploy during cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }

    const deployment = trackedDeploymentId
      ? deployments.find((entry) => entry.deploymentId === trackedDeploymentId)
      : newestReleaseDeployment(deployments);
    if (deployment?.deploymentId) trackedDeploymentId = deployment.deploymentId;

    const stillRunning = deployment?.status === "running";
    const pending = pendingQueueJobsForApplication(queueJobs);
    if (!stillRunning && pending.length === 0) {
      if (!quietSince) quietSince = Date.now();
      if (Date.now() - quietSince >= 3_000) {
        deploymentRequested = false;
        return;
      }
    } else {
      quietSince = 0;
    }
    await delay(500);
  }

  const queueJobs = deploymentRows(await cleanupRequest("deployment.queueList"));
  const deployments = deploymentRows(await cleanupRequest(
    `deployment.all?applicationId=${encodeURIComponent(applicationId)}`,
  ));
  const deployment = trackedDeploymentId
    ? deployments.find((entry) => entry.deploymentId === trackedDeploymentId)
    : newestReleaseDeployment(deployments);
  const pending = pendingQueueJobsForApplication(queueJobs);
  const state = deployment?.status === "running" || pending.length
    ? "a running or queued release"
    : "the required continuous idle window";
  throw new Error(`Dokploy cleanup could not clear ${state}; later releases will remain blocked by preflight.`);
}

function cancelOutstandingDeployment() {
  if (!deploymentRequested) return Promise.resolve();
  if (!cleanupPromise) cleanupPromise = performOutstandingDeploymentCleanup();
  return cleanupPromise;
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

  // Set this before the request: the server may enqueue successfully even if
  // the client loses the response or the Actions runner is interrupted.
  deploymentRequested = true;
  deployRequestController = new AbortController();
  let queued;
  try {
    deployRequestPromise = dokploy("application.deploy", {
      method: "POST",
      body: JSON.stringify({ applicationId, title, description }),
      signal: deployRequestController.signal,
    });
    queued = await deployRequestPromise;
  } finally {
    deployRequestController = undefined;
    deployRequestPromise = undefined;
  }
  const queuedId = typeof queued === "string" ? queued : queued?.deploymentId || queued?.id;
  console.log(`Dokploy accepted verified commit ${commitSha.slice(0, 12)}.`);

  let deployment;
  for (let attempt = 0; attempt < 96; attempt += 1) {
    deployment = newestReleaseDeployment(await currentDeployments(), queuedId);
    if (deployment?.deploymentId) trackedDeploymentId = deployment.deploymentId;

    if (deployment?.status === "done") break;
    if (deployment && ["error", "cancelled"].includes(deployment.status)) {
      throw new Error(`Dokploy deployment ${deployment.deploymentId} ended with ${deployment.status}`);
    }
    await delay(5_000);
  }

  if (deployment?.status !== "done") {
    throw new Error("Dokploy deployment did not finish within 8 minutes");
  }
  deploymentRequested = false;
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
  let shutdownStarted = false;
  const exitAfterCleanup = (code) => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    cancelOutstandingDeployment()
      .catch((error) => console.error(`Cleanup failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => process.exit(code));
  };
  process.once("SIGINT", () => exitAfterCleanup(130));
  process.once("SIGTERM", () => exitAfterCleanup(143));
  try {
    await deploy();
  } catch (error) {
    await cancelOutstandingDeployment();
    throw error;
  }
}
