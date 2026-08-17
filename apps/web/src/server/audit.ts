import "server-only";

import { randomUUID, createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "./db";
import { env } from "./env";
import { requestClientAddress } from "./request-client";

let nextRetentionCleanupAt = 0;
const sensitiveAuditKeys = new Set([
  "content",
  "ciphertext",
  "iv",
  "authtag",
  "secret",
  "password",
  "token",
  "tokenhash",
  "accesstoken",
  "refreshtoken",
  "openid",
  "unionid",
]);

export function sanitizeAuditDetail(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => sanitizeAuditDetail(entry, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      return [key, sensitiveAuditKeys.has(normalized) ? "[REDACTED]" : sanitizeAuditDetail(entry, depth + 1)];
    }),
  );
}

function cleanupExpiredAuditLogs() {
  const now = Date.now();
  if (now < nextRetentionCleanupAt) return;
  nextRetentionCleanupAt = now + 60 * 60 * 1_000;
  try {
    const row = db.prepare("SELECT value FROM platform_settings WHERE key = 'platform'").get() as
      | { value: string }
      | undefined;
    const configured = row ? Number((JSON.parse(row.value) as { auditRetentionDays?: unknown }).auditRetentionDays) : 365;
    const retentionDays = Number.isInteger(configured) && configured >= 30 && configured <= 3_650 ? configured : 365;
    db.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', ?)").run(`-${retentionDays} days`);
  } catch (error) {
    console.error("Audit retention cleanup failed", error);
  }
}

export function audit(input: {
  request?: NextRequest;
  teamId?: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}) {
  const address = input.request ? requestClientAddress(input.request) : null;
  const ipHash = address ? createHmac("sha256", env.jwtSecret).update(`audit-ip:${address}`).digest("hex").slice(0, 24) : null;
  db.prepare(
    `INSERT INTO audit_logs
      (id, team_id, actor_id, action, target_type, target_id, detail, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.teamId || null,
    input.actorId || null,
    input.action,
    input.targetType,
    input.targetId || null,
    JSON.stringify(sanitizeAuditDetail(input.detail || {})),
    ipHash,
  );
  cleanupExpiredAuditLogs();
}
