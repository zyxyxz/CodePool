import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db } from "./db";
import { env } from "./env";

const jwtKey = new TextEncoder().encode(env.jwtSecret);
const issuer = "codepool";

export type Session = {
  userId: string;
  openId?: string;
  sessionVersion?: number;
  scope: "member" | "admin";
};

export async function createSessionToken(session: Session, expiresIn = "7d") {
  let sessionVersion = session.sessionVersion;
  if (session.scope === "member" && sessionVersion === undefined) {
    const user = db
      .prepare("SELECT session_version AS sessionVersion FROM users WHERE id = ? AND status = 'active'")
      .get(session.userId) as { sessionVersion: number } | undefined;
    if (!user) throw new Error("UNAUTHORIZED");
    sessionVersion = user.sessionVersion;
  }
  return new SignJWT({ openId: session.openId, scope: session.scope, sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuer(issuer)
    .setAudience("codepool-app")
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(jwtKey);
}

export async function verifySessionToken(token: string): Promise<Session> {
  const { payload } = await jwtVerify(token, jwtKey, {
    issuer,
    audience: "codepool-app",
  });
  if (!payload.sub || (payload.scope !== "member" && payload.scope !== "admin")) {
    throw new Error("Invalid session");
  }
  return {
    userId: payload.sub,
    openId: typeof payload.openId === "string" ? payload.openId : undefined,
    sessionVersion: typeof payload.sessionVersion === "number" ? payload.sessionVersion : undefined,
    scope: payload.scope,
  };
}

export async function requireMember(request: NextRequest) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");
  let session: Session;
  try {
    session = await verifySessionToken(value.slice(7));
  } catch {
    throw new Error("UNAUTHORIZED");
  }
  if (session.scope !== "member") throw new Error("UNAUTHORIZED");
  const user = db
    .prepare("SELECT session_version AS sessionVersion FROM users WHERE id = ? AND status = 'active'")
    .get(session.userId) as { sessionVersion: number } | undefined;
  if (!user || session.sessionVersion !== user.sessionVersion) throw new Error("UNAUTHORIZED");
  return session;
}

export async function getAdminSession() {
  const token = (await cookies()).get("codepool_admin")?.value;
  if (!token) return null;
  try {
    const session = await verifySessionToken(token);
    return session.scope === "admin" && session.userId === "system-admin" ? session : null;
  } catch {
    return null;
  }
}
