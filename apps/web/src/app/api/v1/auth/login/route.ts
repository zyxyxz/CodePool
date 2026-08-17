import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { createSessionToken } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { writablePlatformSettings } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.object({
  wx_code: z.string().min(1),
  nickname: z.string().trim().min(1).max(64).optional(),
  avatar_url: z.url().optional(),
  open_id: z.string().optional(),
  openId: z.string().optional(),
});

async function exchangeWechat(code: string, openIdHint?: string) {
  if (env.wechatMockLogin) {
    return {
      openId:
        openIdHint || `mock_${createHash("sha256").update(code).digest("hex").slice(0, 24)}`,
      unionId: null,
    };
  }
  if (!env.wechatAppId || !env.wechatAppSecret) throw new Error("微信登录参数未配置");
  const query = new URLSearchParams({
    appid: env.wechatAppId,
    secret: env.wechatAppSecret,
    js_code: code,
    grant_type: "authorization_code",
  });
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, {
    cache: "no-store",
  });
  const data = (await response.json()) as {
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };
  if (!response.ok || !data.openid) throw new Error(data.errmsg || "微信登录失败");
  return { openId: data.openid, unionId: data.unionid || null };
}

export async function POST(request: NextRequest) {
  try {
    enforceRateLimit(request, {
      namespace: "member-login-ip",
      limit: 60,
      windowSeconds: 300,
      errorCode: "LOGIN_RATE_LIMITED",
      message: "登录请求过于频繁，请稍后再试",
    });
    const input = schema.parse(await jsonBody(request));
    const profile = await exchangeWechat(input.wx_code, input.open_id || input.openId);
    enforceRateLimit(request, {
      namespace: "member-login-account",
      subject: `openid:${profile.openId}`,
      limit: 12,
      windowSeconds: 300,
      errorCode: "LOGIN_RATE_LIMITED",
      message: "该账号登录过于频繁，请稍后再试",
    });

    const loginOperation = db.transaction(() => {
      let existing = db.prepare("SELECT id, status FROM users WHERE open_id = ?").get(profile.openId) as
        | { id: string; status: "active" | "disabled" }
        | undefined;
      if (existing?.status === "disabled") {
        throw new ApiError(403, "账号已被停用，请联系管理员", "USER_DISABLED");
      }

      if (existing) {
        db.prepare(
          `UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url),
           union_id = COALESCE(?, union_id), last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(input.nickname || null, input.avatar_url || null, profile.unionId, existing.id);
        return existing.id;
      }

      writablePlatformSettings();
      const newUserId = randomUUID();
      const inserted = db.prepare(
        `INSERT OR IGNORE INTO users (id, open_id, union_id, nickname, avatar_url)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        newUserId,
        profile.openId,
        profile.unionId,
        input.nickname || "微信用户",
        input.avatar_url || null,
      );

      if (!inserted.changes) {
        existing = db.prepare("SELECT id, status FROM users WHERE open_id = ?").get(profile.openId) as
          | { id: string; status: "active" | "disabled" }
          | undefined;
        if (!existing || existing.status === "disabled") {
          throw new ApiError(403, "账号已被停用，请联系管理员", "USER_DISABLED");
        }
        db.prepare(
          `UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url),
           union_id = COALESCE(?, union_id), last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(input.nickname || null, input.avatar_url || null, profile.unionId, existing.id);
        return existing.id;
      }

      const teamId = randomUUID();
      const slug = `pool-${newUserId.slice(0, 12)}`;
      db.prepare("INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)").run(
        teamId,
        "我的代码池",
        slug,
        newUserId,
      );
      db.prepare(
        "INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')",
      ).run(teamId, newUserId);
      return newUserId;
    });
    const userId = loginOperation.immediate();

    const user = db
      .prepare(
        `SELECT id, open_id AS openId, nickname, avatar_url AS avatarUrl,
         created_at AS createdAt, last_login_at AS lastLoginAt FROM users WHERE id = ?`,
      )
      .get(userId);
    const teams = db
      .prepare(
        `SELECT t.id AS teamId, t.name, t.slug, tm.role, t.owner_id AS ownerId,
         t.created_at AS createdAt FROM teams t JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ? AND t.status = 'active'
         AND (tm.expires_at IS NULL OR datetime(tm.expires_at) > CURRENT_TIMESTAMP)
         ORDER BY t.created_at`,
      )
      .all(userId);
    const accessToken = await createSessionToken({ userId, openId: profile.openId, scope: "member" });
    audit({ request, actorId: userId, action: "AUTH_LOGIN", targetType: "user", targetId: userId });
    return ok(
      { accessToken, token: accessToken, user: { ...(user as object), teams } },
      { status: 201, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return fail(error);
  }
}
