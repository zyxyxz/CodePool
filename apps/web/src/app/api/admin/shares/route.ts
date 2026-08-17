import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFail, adminOk, pageData, parsePagination, parseSearch, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";

const statusExpression = `CASE
  WHEN s.revoked_at IS NOT NULL THEN 'revoked'
  WHEN datetime(s.expires_at) <= CURRENT_TIMESTAMP
    OR (v.expires_at IS NOT NULL AND datetime(v.expires_at) <= CURRENT_TIMESTAMP) THEN 'expired'
  WHEN t.status <> 'active' OR v.status <> 'active' THEN 'unavailable'
  WHEN s.view_count >= s.max_views THEN 'consumed'
  ELSE 'active' END`;

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const pagination = parsePagination(request);
    const query = parseSearch(request);
    const rawStatus = request.nextUrl.searchParams.get("status");
    const parsedStatus = z.enum(["active", "used", "expired", "consumed", "revoked", "unavailable"]).optional().parse(!rawStatus || rawStatus === "all" ? undefined : rawStatus);
    const status = parsedStatus === "used" ? "consumed" : parsedStatus;
    const teamId = z.uuid().optional().parse(request.nextUrl.searchParams.get("teamId") || undefined);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (status) {
      clauses.push(`${statusExpression} = ?`);
      values.push(status);
    }
    if (teamId) {
      clauses.push("v.team_id = ?");
      values.push(teamId);
    }
    if (query) {
      clauses.push("(v.title LIKE ? OR t.name LIKE ? OR u.nickname LIKE ? OR s.id LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const joins = `FROM share_links s
      JOIN vault_items v ON v.id = s.item_id
      JOIN teams t ON t.id = v.team_id
      JOIN users u ON u.id = s.created_by`;
    const total = (db.prepare(`SELECT COUNT(*) AS value ${joins} ${where}`).get(...values) as { value: number }).value;
    const items = db
      .prepare(
        `SELECT s.id, ${statusExpression} AS status,
          s.expires_at AS expiresAt, s.max_views AS maxViews,
          s.view_count AS viewCount, s.revoked_at AS revokedAt,
          s.created_at AS createdAt,
          v.id AS itemId, v.title AS itemTitle, v.kind AS itemKind,
          t.id AS teamId, t.name AS teamName,
          u.id AS creatorId, u.nickname AS creatorName
         ${joins} ${where}
         ORDER BY datetime(s.created_at) DESC, s.id LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset);
    return adminOk(pageData(items, total, pagination));
  } catch (error) {
    return adminFail(error);
  }
}
