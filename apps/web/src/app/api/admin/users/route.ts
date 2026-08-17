import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFail, adminOk, pageData, parsePagination, parseSearch, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const pagination = parsePagination(request);
    const query = parseSearch(request);
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = z.enum(["active", "disabled"]).optional().parse(!rawStatus || rawStatus === "all" ? undefined : rawStatus);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (status) {
      clauses.push("u.status = ?");
      values.push(status);
    }
    if (query) {
      clauses.push("(u.nickname LIKE ? OR u.id LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS value FROM users u ${where}`).get(...values) as { value: number }).value;
    const items = db
      .prepare(
        `SELECT u.id, u.nickname, u.avatar_url AS avatarUrl, u.status,
          u.disabled_at AS disabledAt, u.disabled_reason AS disabledReason,
          u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
          (SELECT COUNT(*) FROM team_members tm WHERE tm.user_id = u.id) AS teamCount,
          (SELECT COUNT(*) FROM teams t WHERE t.owner_id = u.id) AS ownedTeamCount,
          (SELECT COUNT(*) FROM vault_items v WHERE v.created_by = u.id) AS itemCount,
          (SELECT COUNT(*) FROM share_links s WHERE s.created_by = u.id) AS shareCount,
          (SELECT r.status FROM account_deletion_requests r WHERE r.user_id = u.id
           ORDER BY datetime(r.requested_at) DESC LIMIT 1) AS deletionRequestStatus
         FROM users u ${where}
         ORDER BY datetime(u.last_login_at) DESC, u.id LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset);
    const countRows = db
      .prepare("SELECT status, COUNT(*) AS count FROM users GROUP BY status")
      .all() as Array<{ status: "active" | "disabled"; count: number }>;
    const counts = { active: 0, disabled: 0 };
    for (const row of countRows) counts[row.status] = row.count;
    return adminOk({ ...pageData(items, total, pagination), counts });
  } catch (error) {
    return adminFail(error);
  }
}
