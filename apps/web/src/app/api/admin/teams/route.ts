import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  adminAudit,
  adminFail,
  adminOk,
  pageData,
  parsePagination,
  parseSearch,
  requireAdminRequest,
} from "@/server/admin";
import { ApiError, jsonBody } from "@/server/api";
import { db } from "@/server/db";

function uniqueSlug(name: string, id: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "pool";
  return `${base}-${id.slice(0, 8)}`;
}

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
      clauses.push("t.status = ?");
      values.push(status);
    }
    if (query) {
      clauses.push("(t.name LIKE ? OR t.slug LIKE ? OR u.nickname LIKE ?)");
      const pattern = `%${query}%`;
      values.push(pattern, pattern, pattern);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = (db
      .prepare(`SELECT COUNT(*) AS value FROM teams t JOIN users u ON u.id = t.owner_id ${where}`)
      .get(...values) as { value: number }).value;
    const items = db
      .prepare(
        `SELECT t.id, t.name, t.slug, t.status,
          t.disabled_at AS disabledAt, t.disabled_reason AS disabledReason,
          t.created_at AS createdAt, t.updated_at AS updatedAt,
          u.id AS ownerId, u.nickname AS ownerName, u.avatar_url AS ownerAvatarUrl,
          (SELECT COUNT(*) FROM team_members tm JOIN users member_u ON member_u.id = tm.user_id
           WHERE tm.team_id = t.id AND member_u.status = 'active'
           AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)) AS memberCount,
          (SELECT COUNT(*) FROM vault_items v WHERE v.team_id = t.id) AS itemCount,
          (SELECT COUNT(*) FROM share_links s JOIN vault_items v ON v.id = s.item_id
           WHERE v.team_id = t.id AND s.revoked_at IS NULL
           AND datetime(s.expires_at) > CURRENT_TIMESTAMP AND s.view_count < s.max_views) AS activeShareCount
         FROM teams t JOIN users u ON u.id = t.owner_id
         ${where}
         ORDER BY datetime(t.updated_at) DESC, t.id
         LIMIT ? OFFSET ?`,
      )
      .all(...values, pagination.pageSize, pagination.offset);
    return adminOk(pageData(items, total, pagination));
  } catch (error) {
    return adminFail(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdminRequest(request, true);
    const input = z
      .object({
        name: z.string().trim().min(2).max(48),
        ownerId: z.uuid(),
      })
      .strict()
      .parse(await jsonBody(request));
    const id = randomUUID();
    const slug = uniqueSlug(input.name, id);
    const operation = db.transaction(() => {
      const owner = db
        .prepare(
          `SELECT u.id, u.nickname FROM users u
           WHERE u.id = ? AND u.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM account_deletion_requests r
             WHERE r.user_id = u.id AND r.status = 'completed'
           )`,
        )
        .get(input.ownerId) as { id: string; nickname: string } | undefined;
      if (!owner) throw new ApiError(404, "未找到可用的团队所有者，请先让用户登录小程序", "OWNER_NOT_FOUND");
      db.prepare("INSERT INTO teams(id, name, slug, owner_id) VALUES (?, ?, ?, ?)").run(id, input.name, slug, owner.id);
      db.prepare("INSERT INTO team_members(team_id, user_id, role) VALUES (?, ?, 'owner')").run(id, owner.id);
      adminAudit(request, session, {
        teamId: id,
        action: "ADMIN_TEAM_CREATE",
        targetType: "team",
        targetId: id,
        detail: { name: input.name, ownerId: owner.id },
      });
      return owner;
    });
    const owner = operation.immediate();
    return adminOk(
      { id, name: input.name, slug, status: "active", ownerId: owner.id, ownerName: owner.nickname },
      { status: 201 },
    );
  } catch (error) {
    return adminFail(error);
  }
}
