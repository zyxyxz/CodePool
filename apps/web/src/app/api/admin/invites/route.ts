import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFail, adminOk, pageData, parsePagination, parseSearch, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";

const statusExpression = `CASE
  WHEN i.revoked_at IS NOT NULL THEN 'revoked'
  WHEN i.used_at IS NOT NULL THEN 'used'
  WHEN datetime(i.expires_at) <= CURRENT_TIMESTAMP THEN 'expired'
  ELSE 'active' END`;

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const pagination = parsePagination(request);
    const query = parseSearch(request);
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = z.enum(["active", "used", "expired", "revoked"]).optional().parse(!rawStatus || rawStatus === "all" ? undefined : rawStatus);
    const role = z.enum(["admin", "member", "guest"]).optional().parse(request.nextUrl.searchParams.get("role") || undefined);
    const teamId = z.uuid().optional().parse(request.nextUrl.searchParams.get("teamId") || undefined);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (status) {
      clauses.push(`${statusExpression} = ?`);
      values.push(status);
    }
    if (role) {
      clauses.push("i.role = ?");
      values.push(role);
    }
    if (teamId) {
      clauses.push("i.team_id = ?");
      values.push(teamId);
    }
    if (query) {
      clauses.push("(t.name LIKE ? OR u.nickname LIKE ? OR i.id LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const joins = `FROM team_invites i
      JOIN teams t ON t.id = i.team_id
      JOIN users u ON u.id = i.created_by`;
    const total = (db.prepare(`SELECT COUNT(*) AS value ${joins} ${where}`).get(...values) as { value: number }).value;
    const items = db
      .prepare(
        `SELECT i.id, i.role, ${statusExpression} AS status,
          i.expires_at AS expiresAt, i.used_at AS usedAt,
          i.revoked_at AS revokedAt, i.created_at AS createdAt,
          t.id AS teamId, t.name AS teamName,
          u.id AS creatorId, u.nickname AS creatorName
         ${joins} ${where}
         ORDER BY datetime(i.created_at) DESC, i.id LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset);
    return adminOk(pageData(items, total, pagination));
  } catch (error) {
    return adminFail(error);
  }
}
