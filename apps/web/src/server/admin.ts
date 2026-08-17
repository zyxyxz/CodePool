import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, fail, ok } from "./api";
import { audit, sanitizeAuditDetail } from "./audit";
import { getAdminSession, type Session } from "./auth";
import { db } from "./db";
import { env } from "./env";
import { requestClientAddress } from "./request-client";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const SETTINGS_KEY = "platform";
const LOGIN_WINDOW_MINUTES = 15;
const LOGIN_EMAIL_LIMIT = 6;
const LOGIN_IP_LIMIT = 15;

export const platformSettingsSchema = z.object({
  workspaceName: z.string().trim().min(2).max(40).default("CodePool"),
  supportEmail: z.union([z.literal(""), z.email()]).default(""),
  announcement: z.string().trim().max(500).default(""),
  maintenanceMode: z.boolean().default(false),
  allowNewTeams: z.boolean().default(true),
  allowPublicShares: z.boolean().default(true),
  allowInvites: z.boolean().default(true),
  maxMembersPerTeam: z.number().int().min(1).max(10_000).default(100),
  maxItemsPerTeam: z.number().int().min(1).max(1_000_000).default(10_000),
  defaultShareTtlMinutes: z.number().int().min(1).max(1_440).default(5),
  maxShareTtlMinutes: z.number().int().min(1).max(10_080).default(1_440),
  defaultInviteTtlHours: z.number().int().min(1).max(720).default(24),
  maxShareViews: z.number().int().min(1).max(10_000).default(20),
  auditRetentionDays: z.number().int().min(30).max(3_650).default(365),
});

export const platformSettingsPatchSchema = platformSettingsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "至少需要修改一项设置");

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;

export type AdminPagination = {
  page: number;
  pageSize: number;
  offset: number;
};

function forwardedHeader(request: NextRequest, name: string) {
  return request.headers.get(name)?.split(",")[0]?.trim() || null;
}

export function assertSameOrigin(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    throw new ApiError(403, "跨站请求已被拒绝", "CSRF_REJECTED");
  }

  const origin = request.headers.get("origin");
  const host = forwardedHeader(request, "x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) {
    if (env.isProduction) {
      throw new ApiError(403, "无法验证请求来源", "CSRF_REJECTED");
    }
    return;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new ApiError(403, "请求来源不合法", "CSRF_REJECTED");
  }
  if (originUrl.host.toLowerCase() !== host.toLowerCase()) {
    throw new ApiError(403, "请求来源不匹配", "CSRF_REJECTED");
  }
  const protocol = forwardedHeader(request, "x-forwarded-proto");
  if (protocol && originUrl.protocol !== `${protocol}:`) {
    throw new ApiError(403, "请求协议不匹配", "CSRF_REJECTED");
  }
}

export async function requireAdminRequest(request: NextRequest, mutation = false) {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  if (mutation) assertSameOrigin(request);
  return session;
}

export function parsePagination(request: NextRequest): AdminPagination {
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(1)
    .parse(request.nextUrl.searchParams.get("page") || undefined);
  const pageSize = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE)
    .parse(request.nextUrl.searchParams.get("pageSize") || undefined);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function parseSearch(request: NextRequest) {
  return z.string().trim().max(120).optional().parse(request.nextUrl.searchParams.get("q") || undefined);
}

export function pageData<T>(items: T[], total: number, pagination: AdminPagination) {
  return {
    items,
    total,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: Math.ceil(total / pagination.pageSize),
  };
}

function withAdminHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function adminOk<T>(data: T, init?: ResponseInit) {
  return withAdminHeaders(ok(data, init));
}

export function adminFail(error: unknown) {
  return withAdminHeaders(fail(error));
}

export function adminAudit(
  request: NextRequest,
  session: Session,
  input: {
    teamId?: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    detail?: Record<string, unknown>;
  },
) {
  audit({
    request,
    teamId: input.teamId,
    actorId: null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    detail: { ...input.detail, adminActor: session.userId },
  });
}

export function getPlatformSettings(): PlatformSettings {
  const row = db.prepare("SELECT value FROM platform_settings WHERE key = ?").get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return platformSettingsSchema.parse({});
  try {
    return platformSettingsSchema.parse(JSON.parse(row.value));
  } catch (error) {
    console.error("Invalid platform settings; defaults are in use", error);
    return platformSettingsSchema.parse({});
  }
}

export function savePlatformSettings(settings: PlatformSettings, updatedBy: string) {
  db.prepare(
    `INSERT INTO platform_settings(key, value, updated_at, updated_by)
     VALUES (?, ?, CURRENT_TIMESTAMP, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = excluded.updated_by`,
  ).run(SETTINGS_KEY, JSON.stringify(settings), updatedBy);
}

function requestIp(request: NextRequest) {
  return requestClientAddress(request) || "unknown";
}

function loginFingerprint(value: string) {
  return createHmac("sha256", env.jwtSecret).update(value).digest("hex").slice(0, 32);
}

export function adminLoginFingerprints(request: NextRequest, email: string) {
  return {
    ipHash: loginFingerprint(`ip:${requestIp(request)}`),
    emailHash: loginFingerprint(`email:${email.trim().toLowerCase()}`),
  };
}

export function enforceAdminLoginRateLimit(ipHash: string, emailHash: string) {
  const counts = db
    .prepare(
      `SELECT
        SUM(CASE WHEN ip_hash = ? THEN 1 ELSE 0 END) AS ipFailures,
        SUM(CASE WHEN email_hash = ? THEN 1 ELSE 0 END) AS emailFailures
       FROM admin_login_attempts
       WHERE succeeded = 0
       AND created_at >= datetime('now', ?)
       AND created_at > COALESCE(
         (SELECT MAX(created_at) FROM admin_login_attempts
          WHERE succeeded = 1 AND (ip_hash = ? OR email_hash = ?)),
         datetime('now', ?)
       )`,
    )
    .get(
      ipHash,
      emailHash,
      `-${LOGIN_WINDOW_MINUTES} minutes`,
      ipHash,
      emailHash,
      `-${LOGIN_WINDOW_MINUTES} minutes`,
    ) as { ipFailures: number | null; emailFailures: number | null };
  if ((counts.ipFailures || 0) >= LOGIN_IP_LIMIT || (counts.emailFailures || 0) >= LOGIN_EMAIL_LIMIT) {
    throw new ApiError(
      429,
      `登录尝试过多，请 ${LOGIN_WINDOW_MINUTES} 分钟后再试`,
      "ADMIN_LOGIN_RATE_LIMITED",
      { "Retry-After": String(LOGIN_WINDOW_MINUTES * 60) },
    );
  }
}

export function recordAdminLoginAttempt(ipHash: string, emailHash: string, succeeded: boolean) {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO admin_login_attempts(id, ip_hash, email_hash, succeeded)
       VALUES (?, ?, ?, ?)`,
    ).run(randomUUID(), ipHash, emailHash, succeeded ? 1 : 0);
    db.prepare("DELETE FROM admin_login_attempts WHERE created_at < datetime('now', '-7 days')").run();
  })();
}

export function parseAuditDetail(value: string) {
  try {
    return sanitizeAuditDetail(JSON.parse(value || "{}"));
  } catch {
    return {};
  }
}
