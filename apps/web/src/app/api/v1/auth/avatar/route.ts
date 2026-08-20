import type { NextRequest } from "next/server";
import { fail, jsonBody, ok } from "@/server/api";
import { requireMember } from "@/server/auth";
import { audit } from "@/server/audit";
import {
  avatarPayloadSchema,
  MAX_AVATAR_JSON_BYTES,
  sanitizeAvatar,
  signedMemberAvatarUrl,
} from "@/server/avatar";
import { db } from "@/server/db";
import { enforceRateLimit } from "@/server/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const session = await requireMember(request);
    enforceRateLimit(request, {
      namespace: "profile-avatar-update-user",
      subject: `user:${session.userId}`,
      limit: 20,
      windowSeconds: 3_600,
      errorCode: "PROFILE_AVATAR_UPDATE_RATE_LIMITED",
    });
    const input = avatarPayloadSchema.parse(await jsonBody(request, MAX_AVATAR_JSON_BYTES));
    const avatar = await sanitizeAvatar(input.data, input.mimeType);
    const update = db.transaction(() => {
      const row = db
        .prepare(
          `UPDATE users SET avatar_blob = ?, avatar_mime = ?,
             avatar_version = avatar_version + 1,
             avatar_url = '/api/v1/avatars/' || id || '?v=' || (avatar_version + 1)
           WHERE id = ? AND status = 'active' AND session_version = ?
           RETURNING avatar_url AS avatarUrl, avatar_version AS avatarVersion`,
        )
        .get(avatar.bytes, avatar.mime, session.userId, session.sessionVersion) as
          | { avatarUrl: string; avatarVersion: number }
          | undefined;
      if (!row) throw new Error("UNAUTHORIZED");
      audit({
        request,
        actorId: session.userId,
        action: "PROFILE_AVATAR_UPDATE",
        targetType: "user",
        targetId: session.userId,
        detail: {
          mime: avatar.mime,
          bytes: avatar.bytes.length,
          inputMime: avatar.inputMime,
          inputWidth: avatar.width,
          inputHeight: avatar.height,
          avatarVersion: row.avatarVersion,
        },
      });
      return row;
    });
    const updated = update.immediate();
    return ok({
      ...updated,
      avatarUrl: signedMemberAvatarUrl(session.userId, updated.avatarVersion, updated.avatarUrl),
    });
  } catch (error) {
    return fail(error);
  }
}
