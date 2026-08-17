import "server-only";

import { randomUUID, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { db } from "./db";

export function audit(input: {
  request?: NextRequest;
  teamId?: string | null;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  detail?: Record<string, unknown>;
}) {
  const forwarded = input.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipHash = forwarded ? createHash("sha256").update(forwarded).digest("hex").slice(0, 16) : null;
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
    JSON.stringify(input.detail || {}),
    ipHash,
  );
}
