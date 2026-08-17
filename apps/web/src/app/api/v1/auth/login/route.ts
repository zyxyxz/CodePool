import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { created, fail, jsonBody } from "@/server/api";
import { createSessionToken } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { env } from "@/server/env";

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
    const input = schema.parse(await jsonBody(request));
    const profile = await exchangeWechat(input.wx_code, input.open_id || input.openId);
    const existing = db.prepare("SELECT id FROM users WHERE open_id = ?").get(profile.openId) as
      | { id: string }
      | undefined;
    const userId = existing?.id || randomUUID();

    db.transaction(() => {
      if (existing) {
        db.prepare(
          `UPDATE users SET nickname = COALESCE(?, nickname), avatar_url = COALESCE(?, avatar_url),
           union_id = COALESCE(?, union_id), last_login_at = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(input.nickname || null, input.avatar_url || null, profile.unionId, userId);
      } else {
        db.prepare(
          `INSERT INTO users (id, open_id, union_id, nickname, avatar_url)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(userId, profile.openId, profile.unionId, input.nickname || "微信用户", input.avatar_url || null);
        const teamId = randomUUID();
        const slug = `pool-${userId.slice(0, 8)}`;
        db.prepare("INSERT INTO teams (id, name, slug, owner_id) VALUES (?, ?, ?, ?)").run(
          teamId,
          "我的代码池",
          slug,
          userId,
        );
        db.prepare(
          "INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'owner')",
        ).run(teamId, userId);
      }
    })();

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
         WHERE tm.user_id = ? ORDER BY t.created_at`,
      )
      .all(userId);
    const accessToken = await createSessionToken({ userId, openId: profile.openId, scope: "member" });
    audit({ request, actorId: userId, action: "AUTH_LOGIN", targetType: "user", targetId: userId });
    return created({ accessToken, token: accessToken, user: { ...(user as object), teams } });
  } catch (error) {
    return fail(error);
  }
}
