import type { NextRequest } from "next/server";
import { z } from "zod";
import { getItemForUser, requireTeamRole } from "@/server/access";
import { audit } from "@/server/audit";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";
import { accountSummary, type ItemRow } from "@/server/items";

type Context = { params: Promise<{ accountId: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { accountId } = await context.params;
    const row = getItemForUser(userId, accountId) as unknown as ItemRow;
    if (row.kind !== "totp") throw new ApiError(404, "动态验证码不存在", "ACCOUNT_NOT_FOUND");
    return ok(accountSummary(row));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { accountId } = await context.params;
    const row = getItemForUser(userId, accountId) as unknown as ItemRow;
    requireTeamRole(userId, row.team_id, ["owner", "admin"]);
    const input = z.object({
      issuer: z.string().trim().min(1).max(120).optional(),
      label: z.string().trim().min(1).max(160).optional(),
      accountIdentifier: z.string().trim().max(160).nullable().optional(),
      account_identifier: z.string().trim().max(160).nullable().optional(),
      remark: z.string().trim().max(500).nullable().optional(),
    }).parse(await jsonBody(request));
    const metadata = { ...(JSON.parse(row.metadata) as Record<string, unknown>) };
    if (input.issuer !== undefined) metadata.issuer = input.issuer;
    if (input.label !== undefined) metadata.label = input.label;
    if (input.remark !== undefined) metadata.remark = input.remark;
    const identifier = input.accountIdentifier !== undefined ? input.accountIdentifier : input.account_identifier !== undefined ? input.account_identifier : row.identifier;
    db.prepare(
      `UPDATE vault_items SET title = ?, identifier = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run((metadata.issuer as string) || row.title, identifier, JSON.stringify(metadata), accountId);
    audit({ request, teamId: row.team_id, actorId: userId, action: "TOTP_UPDATE", targetType: "totp", targetId: accountId });
    return ok(accountSummary(db.prepare("SELECT * FROM vault_items WHERE id = ?").get(accountId) as ItemRow));
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const { userId } = await requireMember(request);
    const { accountId } = await context.params;
    const row = getItemForUser(userId, accountId) as unknown as ItemRow;
    requireTeamRole(userId, row.team_id, ["owner", "admin"]);
    db.prepare("DELETE FROM vault_items WHERE id = ?").run(accountId);
    audit({ request, teamId: row.team_id, actorId: userId, action: "TOTP_DELETE", targetType: "totp", targetId: accountId });
    return ok({ success: true });
  } catch (error) {
    return fail(error);
  }
}
