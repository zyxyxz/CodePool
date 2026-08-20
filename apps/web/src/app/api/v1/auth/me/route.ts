import type { NextRequest } from "next/server";
import { z } from "zod";
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

const profileSchema = z.object({
  nickname: z.string().trim().min(1).max(64).optional(),
  avatar: avatarPayloadSchema.optional(),
}).strict().refine((input) => input.nickname !== undefined || input.avatar !== undefined, {
  message: "至少需要更新一项资料",
});

function userProfile(userId: string) {
  const user = db
    .prepare(
      `SELECT id, open_id AS openId, nickname, avatar_url AS avatarUrl,
       avatar_version AS avatarVersion, created_at AS createdAt,
       last_login_at AS lastLoginAt
       FROM users WHERE id = ? AND status = 'active'`,
    )
    .get(userId) as {
      id: string;
      openId: string;
      nickname: string;
      avatarUrl: string | null;
      avatarVersion: number;
      createdAt: string;
      lastLoginAt: string;
    } | undefined;
  if (!user) return undefined;
  return {
    ...user,
    avatarUrl: signedMemberAvatarUrl(user.id, user.avatarVersion, user.avatarUrl),
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = await requireMember(request);
    const user = userProfile(session.userId);
    if (!user) throw new Error("UNAUTHORIZED");
    const teams = db
      .prepare(
        `SELECT t.id AS teamId, t.name, t.slug, t.owner_id AS ownerId, tm.role,
         tm.expires_at AS expiresAt, t.created_at AS createdAt
         FROM teams t JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ? AND t.status = 'active'
         AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
         ORDER BY t.updated_at DESC`,
      )
      .all(session.userId);
    return ok({ user, teams });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireMember(request);
    enforceRateLimit(request, {
      namespace: "profile-update-user",
      subject: `user:${session.userId}`,
      limit: 30,
      windowSeconds: 3_600,
      errorCode: "PROFILE_UPDATE_RATE_LIMITED",
    });
    const input = profileSchema.parse(await jsonBody(request, MAX_AVATAR_JSON_BYTES));
    if (input.avatar) {
      enforceRateLimit(request, {
        namespace: "profile-avatar-update-user",
        subject: `user:${session.userId}`,
        limit: 20,
        windowSeconds: 3_600,
        errorCode: "PROFILE_AVATAR_UPDATE_RATE_LIMITED",
      });
    }
    const avatar = input.avatar
      ? await sanitizeAvatar(input.avatar.data, input.avatar.mimeType)
      : null;
    const update = db.transaction(() => {
      const current = db
        .prepare(
          `SELECT 1 FROM users
           WHERE id = ? AND status = 'active' AND session_version = ?`,
        )
        .get(session.userId, session.sessionVersion);
      if (!current) throw new Error("UNAUTHORIZED");
      if (input.nickname !== undefined) {
        db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(input.nickname, session.userId);
        audit({
          request,
          actorId: session.userId,
          action: "PROFILE_UPDATE",
          targetType: "user",
          targetId: session.userId,
          detail: { fields: ["nickname"] },
        });
      }
      if (avatar) {
        db.prepare(
          `UPDATE users SET avatar_blob = ?, avatar_mime = ?,
             avatar_version = avatar_version + 1,
             avatar_url = '/api/v1/avatars/' || id || '?v=' || (avatar_version + 1)
           WHERE id = ?`,
        ).run(avatar.bytes, avatar.mime, session.userId);
        const version = (db
          .prepare("SELECT avatar_version AS value FROM users WHERE id = ?")
          .get(session.userId) as { value: number }).value;
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
            avatarVersion: version,
          },
        });
      }
      return userProfile(session.userId);
    });
    return ok({ user: update.immediate() });
  } catch (error) {
    return fail(error);
  }
}
