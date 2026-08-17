import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  adminFail,
  adminOk,
  pageData,
  parseAuditDetail,
  parsePagination,
  parseSearch,
  requireAdminRequest,
} from "@/server/admin";
import { db } from "@/server/db";

const dateParam = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), "日期格式不正确")
  .optional();

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const pagination = parsePagination(request);
    const query = parseSearch(request);
    const rawAction = request.nextUrl.searchParams.get("action");
    const action = z.string().trim().max(80).optional().parse(!rawAction || rawAction === "all" ? undefined : rawAction);
    const targetType = z.string().trim().max(80).optional().parse(request.nextUrl.searchParams.get("targetType") || undefined);
    const teamId = z.uuid().optional().parse(request.nextUrl.searchParams.get("teamId") || undefined);
    const actorId = z.uuid().optional().parse(request.nextUrl.searchParams.get("actorId") || undefined);
    const dateFrom = dateParam.parse(request.nextUrl.searchParams.get("dateFrom") || undefined);
    const dateTo = dateParam.parse(request.nextUrl.searchParams.get("dateTo") || undefined);
    const range = z.enum(["24h", "7d", "30d", "90d", "all"]).default("30d").parse(request.nextUrl.searchParams.get("range") || undefined);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (action) {
      clauses.push("a.action = ?");
      values.push(action);
    }
    if (targetType) {
      clauses.push("a.target_type = ?");
      values.push(targetType);
    }
    if (teamId) {
      clauses.push("a.team_id = ?");
      values.push(teamId);
    }
    if (actorId) {
      clauses.push("a.actor_id = ?");
      values.push(actorId);
    }
    if (dateFrom) {
      clauses.push("datetime(a.created_at) >= datetime(?)");
      values.push(dateFrom);
    }
    if (dateTo) {
      clauses.push("datetime(a.created_at) <= datetime(?)");
      values.push(dateTo);
    }
    if (!dateFrom && range !== "all") {
      const modifiers = { "24h": "-24 hours", "7d": "-7 days", "30d": "-30 days", "90d": "-90 days" } as const;
      clauses.push("datetime(a.created_at) >= datetime('now', ?)");
      values.push(modifiers[range]);
    }
    if (query) {
      clauses.push("(a.action LIKE ? OR a.target_type LIKE ? OR a.target_id LIKE ? OR u.nickname LIKE ? OR t.name LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const joins = `FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_id
      LEFT JOIN teams t ON t.id = a.team_id`;
    const total = (db.prepare(`SELECT COUNT(*) AS value ${joins} ${where}`).get(...values) as { value: number }).value;
    const rows = db
      .prepare(
        `SELECT a.id, a.action, a.target_type AS targetType, a.target_id AS targetId,
          a.detail, a.created_at AS createdAt,
          u.id AS actorId, u.nickname AS actorName, u.avatar_url AS actorAvatarUrl,
          t.id AS teamId, t.name AS teamName
         ${joins} ${where}
         ORDER BY datetime(a.created_at) DESC, a.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset) as Array<Record<string, unknown> & {
        action: string;
        actorId: string | null;
        actorName: string | null;
        detail: string;
      }>;
    const items = rows.map(({ detail, ...row }) => ({
      ...row,
      actorType: row.actorId ? "member" : row.action.startsWith("ADMIN_") ? "admin" : "system",
      actorName: row.actorName || (row.action.startsWith("ADMIN_") ? "系统管理员" : "系统"),
      detail: parseAuditDetail(detail),
    }));
    const actions = db
      .prepare(
        `SELECT action, COUNT(*) AS count FROM audit_logs
         GROUP BY action ORDER BY count DESC, action LIMIT 100`,
      )
      .all();
    return adminOk({ ...pageData(items, total, pagination), actions });
  } catch (error) {
    return adminFail(error);
  }
}
