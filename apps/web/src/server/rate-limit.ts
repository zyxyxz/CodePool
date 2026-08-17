import "server-only";

import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError } from "./api";
import { db } from "./db";
import { env } from "./env";
import { requestClientAddress } from "./request-client";

type RateLimitInput = {
  namespace: string;
  limit: number;
  windowSeconds: number;
  subject?: string;
  errorCode?: string;
  message?: string;
};

type RateLimitRow = {
  count: number;
  reset_at: number;
};

let initialized = false;
const MAX_BUCKETS = 25_000;

function ensureTable() {
  if (initialized) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_api_rate_limits_reset
      ON api_rate_limits(reset_at);
  `);
  initialized = true;
}

function requestIdentity(request: NextRequest) {
  return requestClientAddress(request) || "unknown";
}

function fingerprint(value: string) {
  return createHmac("sha256", env.jwtSecret).update(value).digest("hex");
}

/**
 * Persistent, process-safe fixed-window limiter backed by SQLite.
 * The raw IP/user/token value is never stored.
 */
export function enforceRateLimit(request: NextRequest, input: RateLimitInput) {
  ensureTable();
  const now = Math.floor(Date.now() / 1_000);
  const resetAt = now + input.windowSeconds;
  const identity = input.subject || `ip:${requestIdentity(request)}`;
  const requestedBucket = `${input.namespace}:${fingerprint(identity)}`;
  const row = db.transaction(() => {
    db.prepare("DELETE FROM api_rate_limits WHERE reset_at <= ?").run(now);
    const exists = db.prepare("SELECT 1 FROM api_rate_limits WHERE bucket = ?").get(requestedBucket);
    const bucketCount = exists
      ? 0
      : (db.prepare("SELECT COUNT(*) AS value FROM api_rate_limits").get() as { value: number }).value;
    const bucket = !exists && bucketCount >= MAX_BUCKETS
      ? `${input.namespace}:overflow`
      : requestedBucket;
    return db
      .prepare(
        `INSERT INTO api_rate_limits(bucket, count, reset_at, updated_at)
         VALUES (?, 1, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(bucket) DO UPDATE SET
           count = api_rate_limits.count + 1,
           updated_at = CURRENT_TIMESTAMP
         RETURNING count, reset_at`,
      )
      .get(bucket, resetAt) as RateLimitRow;
  })();

  if (row.count > input.limit) {
    const retryAfter = Math.max(1, row.reset_at - now);
    throw new ApiError(
      429,
      input.message || `请求过于频繁，请 ${retryAfter} 秒后再试`,
      input.errorCode || "RATE_LIMITED",
      {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(input.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(row.reset_at),
      },
    );
  }

  return {
    limit: input.limit,
    remaining: Math.max(0, input.limit - row.count),
    resetAt: row.reset_at,
  };
}
