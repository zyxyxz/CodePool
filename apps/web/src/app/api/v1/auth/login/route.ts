import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, fail, jsonBody, ok } from "@/server/api";
import { createSessionToken } from "@/server/auth";
import { audit } from "@/server/audit";
import { signedMemberAvatarUrl } from "@/server/avatar";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { writablePlatformSettings } from "@/server/quota";
import { enforceRateLimit } from "@/server/rate-limit";

const schema = z.object({
  wx_code: z.string().min(1),
  nickname: z.string().trim().min(1).max(64).optional(),
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
  if (!env.wechatAppId || !env.wechatAppSecret) {
    console.error("WeChat jscode2session failed", { errcode: null, rid: null });
    throw new ApiError(503, "微信登录配置异常，请联系管理员", "WECHAT_CONFIGURATION_ERROR");
  }
  const query = new URLSearchParams({
    appid: env.wechatAppId,
    secret: env.wechatAppSecret,
    js_code: code,
    grant_type: "authorization_code",
  });
  let response: Response;
  let data: {
    openid?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
    rid?: string;
  };

  try {
    response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`, {
      cache: "no-store",
    });
    const payload = await response.json() as unknown;
    data = payload && typeof payload === "object" ? payload as typeof data : {};
  } catch {
    console.error("WeChat jscode2session failed", { errcode: null, rid: null });
    throw new ApiError(503, "微信服务暂时不可用，请稍后重试", "WECHAT_UPSTREAM_UNAVAILABLE");
  }

  if (!response.ok || !data.openid) {
    const errcode = typeof data.errcode === "number" ? data.errcode : null;
    const rid = data.rid || /\brid:\s*([^\s,]+)/i.exec(data.errmsg || "")?.[1] || null;
    console.error("WeChat jscode2session failed", { errcode, rid });
    if (errcode === 40029) {
      throw new ApiError(401, "微信登录凭证已失效，请重试", "WECHAT_CODE_INVALID");
    }
    if (errcode === 40125 || errcode === 40164) {
      throw new ApiError(503, "微信登录配置异常，请联系管理员", "WECHAT_CONFIGURATION_ERROR");
    }
    throw new ApiError(503, "微信服务暂时不可用，请稍后重试", "WECHAT_UPSTREAM_UNAVAILABLE");
  }
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
          `UPDATE users SET nickname = COALESCE(?, nickname),
           union_id = COALESCE(?, union_id), last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(input.nickname || null, profile.unionId, existing.id);
        return existing.id;
      }

      writablePlatformSettings();
      const newUserId = randomUUID();
      const inserted = db.prepare(
        `INSERT OR IGNORE INTO users (id, open_id, union_id, nickname)
         VALUES (?, ?, ?, ?)`,
      ).run(
        newUserId,
        profile.openId,
        profile.unionId,
        input.nickname || "微信用户",
      );

      if (!inserted.changes) {
        existing = db.prepare("SELECT id, status FROM users WHERE open_id = ?").get(profile.openId) as
          | { id: string; status: "active" | "disabled" }
          | undefined;
        if (!existing || existing.status === "disabled") {
          throw new ApiError(403, "账号已被停用，请联系管理员", "USER_DISABLED");
        }
        db.prepare(
          `UPDATE users SET nickname = COALESCE(?, nickname),
           union_id = COALESCE(?, union_id), last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(input.nickname || null, profile.unionId, existing.id);
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

    const storedUser = db
      .prepare(
        `SELECT id, open_id AS openId, nickname, avatar_url AS avatarUrl,
         avatar_version AS avatarVersion,
         created_at AS createdAt, last_login_at AS lastLoginAt FROM users WHERE id = ?`,
      )
      .get(userId) as {
        id: string;
        openId: string;
        nickname: string;
        avatarUrl: string | null;
        avatarVersion: number;
        createdAt: string;
        lastLoginAt: string;
      };
    const { avatarVersion, ...publicUser } = storedUser;
    const user = {
      ...publicUser,
      avatarUrl: signedMemberAvatarUrl(storedUser.id, avatarVersion, storedUser.avatarUrl),
    };
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
