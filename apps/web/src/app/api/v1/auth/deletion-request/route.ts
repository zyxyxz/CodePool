import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { db } from "@/server/db";
import { enforceRateLimit } from "@/server/rate-limit";

type DeletionRequestRow = {
  id: string;
  status: "pending" | "approved" | "rejected" | "completed" | "cancelled";
  requested_at: string;
  processed_at: string | null;
  request_note: string | null;
  processor_note: string | null;
};

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const createSchema = z.object({ note: z.string().trim().max(500).nullable().optional() }).strict();

function publicRequest(row: DeletionRequestRow | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requested_at,
    requested_at: row.requested_at,
    processedAt: row.processed_at,
    processed_at: row.processed_at,
    note: row.processor_note || row.request_note,
    requestNote: row.request_note,
    request_note: row.request_note,
    processorNote: row.processor_note,
    processor_note: row.processor_note,
  };
}

function responseData(row: DeletionRequestRow | undefined) {
  const active = row?.status === "pending" || row?.status === "approved";
  return {
    request: publicRequest(row),
    canRequest: !active,
    can_request: !active,
    canWithdraw: row?.status === "pending",
    can_withdraw: row?.status === "pending",
  };
}

function latestRequest(userId: string) {
  return db
    .prepare(
      `SELECT id, status, requested_at, processed_at,
        request_note, processor_note
       FROM account_deletion_requests
       WHERE user_id = ? ORDER BY requested_at DESC LIMIT 1`,
    )
    .get(userId) as DeletionRequestRow | undefined;
}

function withNoStore(response: Response) {
  Object.entries(NO_STORE_HEADERS).forEach(([name, value]) => response.headers.set(name, value));
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    return ok(responseData(latestRequest(userId)), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return withNoStore(fail(error));
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    enforceRateLimit(request, {
      namespace: "account-deletion-request",
      subject: `user:${userId}`,
      limit: 10,
      windowSeconds: 86_400,
      errorCode: "DELETION_REQUEST_RATE_LIMITED",
    });
    const input = createSchema.parse(await jsonBody(request));
    await requireMember(request);
    const id = randomUUID();
    const inserted = db
      .prepare(
        `INSERT INTO account_deletion_requests(id, user_id, note, request_note)
         SELECT ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM account_deletion_requests
           WHERE user_id = ? AND status IN ('pending', 'approved')
         )
         RETURNING id, status, requested_at, processed_at,
           request_note, processor_note`,
      )
      .get(id, userId, input.note || null, input.note || null, userId) as DeletionRequestRow | undefined;
    const row = inserted || latestRequest(userId);
    if (inserted) {
      audit({
        request,
        actorId: userId,
        action: "ACCOUNT_DELETION_REQUEST",
        targetType: "user",
        targetId: userId,
        detail: { requestId: inserted.id },
      });
    }
    return ok(
      { ...responseData(row), created: Boolean(inserted) },
      { status: inserted ? 201 : 200, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return withNoStore(fail(error));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId } = await requireMember(request);
    enforceRateLimit(request, {
      namespace: "account-deletion-withdraw",
      subject: `user:${userId}`,
      limit: 10,
      windowSeconds: 86_400,
      errorCode: "DELETION_REQUEST_RATE_LIMITED",
    });
    const cancelled = db
      .prepare(
        `UPDATE account_deletion_requests
         SET status = 'cancelled', processed_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND status = 'pending'
         RETURNING id`,
      )
      .all(userId) as Array<{ id: string }>;
    if (cancelled.length) {
      audit({
        request,
        actorId: userId,
        action: "ACCOUNT_DELETION_WITHDRAW",
        targetType: "user",
        targetId: userId,
        detail: { requestIds: cancelled.map((entry) => entry.id) },
      });
    }
    return ok(
      {
        ...responseData(latestRequest(userId)),
        success: true,
        cancelled: cancelled.length > 0,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return withNoStore(fail(error));
  }
}
