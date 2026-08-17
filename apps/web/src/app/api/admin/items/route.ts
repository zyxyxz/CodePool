import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminFail, adminOk, pageData, parsePagination, parseSearch, requireAdminRequest } from "@/server/admin";
import { db } from "@/server/db";

const kinds = ["totp", "code", "snippet", "secret", "note"] as const;

export async function GET(request: NextRequest) {
  try {
    await requireAdminRequest(request);
    const pagination = parsePagination(request);
    const query = parseSearch(request);
    const rawKind = request.nextUrl.searchParams.get("kind");
    const rawStatus = request.nextUrl.searchParams.get("status");
    const kind = z.enum(kinds).optional().parse(!rawKind || rawKind === "all" ? undefined : rawKind);
    const status = z.enum(["active", "disabled", "expired", "unavailable"]).optional().parse(!rawStatus || rawStatus === "all" ? undefined : rawStatus);
    const teamId = z.uuid().optional().parse(request.nextUrl.searchParams.get("teamId") || undefined);
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (kind) {
      clauses.push("v.kind = ?");
      values.push(kind);
    }
    if (status) {
      if (status === "expired") {
        clauses.push("v.expires_at IS NOT NULL AND datetime(v.expires_at) <= CURRENT_TIMESTAMP");
      } else if (status === "active") {
        clauses.push("v.status = 'active' AND t.status = 'active' AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)");
      } else if (status === "unavailable") {
        clauses.push("v.status = 'active' AND t.status <> 'active' AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)");
      } else {
        clauses.push("v.status = 'disabled'");
      }
    }
    if (teamId) {
      clauses.push("v.team_id = ?");
      values.push(teamId);
    }
    if (query) {
      clauses.push("(v.title LIKE ? OR v.identifier LIKE ? OR t.name LIKE ? OR u.nickname LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const joins = "FROM vault_items v JOIN teams t ON t.id = v.team_id JOIN users u ON u.id = v.created_by";
    const total = (db.prepare(`SELECT COUNT(*) AS value ${joins} ${where}`).get(...values) as { value: number }).value;
    const items = db
      .prepare(
        `SELECT v.id, v.kind, v.title, v.identifier, v.language,
          CASE
            WHEN v.expires_at IS NOT NULL AND datetime(v.expires_at) <= CURRENT_TIMESTAMP THEN 'expired'
            WHEN v.status = 'disabled' THEN 'disabled'
            WHEN t.status <> 'active' THEN 'unavailable'
            ELSE 'active' END AS status,
          v.status AS moderationStatus,
          v.expires_at AS expiresAt, v.disabled_at AS disabledAt,
          v.disabled_reason AS disabledReason, v.created_at AS createdAt,
          v.updated_at AS updatedAt,
          CASE WHEN v.expires_at IS NOT NULL AND datetime(v.expires_at) <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS isExpired,
          t.id AS teamId, t.name AS teamName, t.status AS teamStatus,
          u.id AS creatorId, u.nickname AS creatorName,
          (SELECT COUNT(*) FROM share_links s WHERE s.item_id = v.id) AS shareCount,
          (SELECT COUNT(*) FROM share_links s WHERE s.item_id = v.id
           AND s.revoked_at IS NULL AND datetime(s.expires_at) > CURRENT_TIMESTAMP
           AND s.view_count < s.max_views
           AND v.status = 'active' AND t.status = 'active'
           AND (v.expires_at IS NULL OR datetime(v.expires_at) > CURRENT_TIMESTAMP)) AS activeShareCount
         ${joins} ${where}
         ORDER BY datetime(v.updated_at) DESC, v.id LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset);
    return adminOk(pageData(items, total, pagination));
  } catch (error) {
    return adminFail(error);
  }
}
