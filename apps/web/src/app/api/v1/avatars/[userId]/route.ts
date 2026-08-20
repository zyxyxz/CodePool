import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySessionToken } from "@/server/auth";
import { verifyAvatarCapability } from "@/server/avatar";
import { db } from "@/server/db";

type Context = { params: Promise<{ userId: string }> };

type AvatarRow = {
  avatar_blob: Buffer;
  avatar_mime: "image/jpeg" | "image/png" | "image/webp";
  avatar_version: number;
};

const NOT_FOUND_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function sameOriginRequest(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const source = request.headers.get("origin") || request.headers.get("referer");
  if (!source) return false;
  try {
    return new URL(source).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function hasSameOriginAdminCookie(request: NextRequest) {
  if (!sameOriginRequest(request)) return false;
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("codepool_admin="));
  if (!cookie) return false;
  const token = cookie.slice("codepool_admin=".length);
  if (!token) return false;
  try {
    const session = await verifySessionToken(token);
    return session.scope === "admin" && session.userId === "system-admin";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest, context: Context) {
  const { userId } = await context.params;
  if (!z.uuid().safeParse(userId).success) {
    return new NextResponse(null, { status: 404, headers: NOT_FOUND_HEADERS });
  }
  const avatar = db
    .prepare(
      `SELECT avatar_blob, avatar_mime, avatar_version
       FROM users
       WHERE id = ? AND status = 'active'
         AND avatar_blob IS NOT NULL AND avatar_mime IS NOT NULL`,
    )
    .get(userId) as AvatarRow | undefined;
  if (!avatar) return new NextResponse(null, { status: 404, headers: NOT_FOUND_HEADERS });
  const searchParams = new URL(request.url).searchParams;
  const capabilityValid = verifyAvatarCapability({
    userId,
    avatarVersion: avatar.avatar_version,
    requestedVersion: searchParams.get("v"),
    expires: searchParams.get("exp"),
    signature: searchParams.get("sig"),
  });
  if (!capabilityValid && !await hasSameOriginAdminCookie(request)) {
    return new NextResponse(null, { status: 404, headers: NOT_FOUND_HEADERS });
  }

  const etag = `"avatar-${userId}-${avatar.avatar_version}"`;
  const headers = new Headers({
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    "Content-Type": avatar.avatar_mime,
    "Content-Length": String(avatar.avatar_blob.length),
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("if-none-match") === etag) {
    headers.delete("Content-Length");
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(new Uint8Array(avatar.avatar_blob), { status: 200, headers });
}
