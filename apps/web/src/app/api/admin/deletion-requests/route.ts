import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFail, adminOk, pageData, parsePagination, parseSearch, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";

const statuses = ["pending", "approved", "rejected", "completed", "cancelled"] as const;

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const pagination = parsePagination(request);
    const query = parseSearch(request);
    const rawStatus = request.nextUrl.searchParams.get("status");
    const status = z.enum(statuses).optional().parse(!rawStatus || rawStatus === "all" ? undefined : rawStatus);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (status) {
      clauses.push("r.status = ?");
      values.push(status);
    }
    if (query) {
      clauses.push("(u.nickname LIKE ? OR u.id LIKE ? OR r.id LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const joins = "FROM account_deletion_requests r JOIN users u ON u.id = r.user_id";
    const total = (db.prepare(`SELECT COUNT(*) AS value ${joins} ${where}`).get(...values) as { value: number }).value;
    const items = db
      .prepare(
        `SELECT r.id, r.status, r.requested_at AS requestedAt,
          r.processed_at AS processedAt,
          r.request_note AS requestNote,
          r.processor_note AS processorNote,
          u.id AS userId, u.nickname, u.avatar_url AS avatarUrl,
          u.status AS userStatus,
          (SELECT COUNT(*) FROM teams t WHERE t.owner_id = u.id) AS ownedTeamCount,
          (SELECT COUNT(*) FROM teams t WHERE t.owner_id = u.id AND t.status = 'active') AS activeOwnedTeamCount,
          (SELECT COUNT(*) FROM teams t WHERE t.owner_id = u.id AND t.status = 'active'
           AND EXISTS (
             SELECT 1 FROM team_members tm JOIN users x ON x.id = tm.user_id
             WHERE tm.team_id = t.id AND tm.user_id <> t.owner_id
             AND x.status = 'active'
             AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
           )) AS blockingOwnedTeamCount
         ${joins} ${where}
         ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          datetime(r.requested_at) DESC, r.id LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset);
    const countRows = db
      .prepare("SELECT status, COUNT(*) AS count FROM account_deletion_requests GROUP BY status")
      .all() as Array<{ status: (typeof statuses)[number]; count: number }>;
    const counts = Object.fromEntries(statuses.map((value) => [value, 0])) as Record<(typeof statuses)[number], number>;
    for (const row of countRows) counts[row.status] = row.count;
    return adminOk({ ...pageData(items, total, pagination), counts });
  } catch (error) {
    return adminFail(error);
  }
}
