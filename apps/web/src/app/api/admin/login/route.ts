import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  adminAudit,
  adminFail,
  adminLoginFingerprints,
  adminOk,
  assertSameOrigin,
  enforceAdminLoginRateLimit,
  recordAdminLoginAttempt,
} from "@/server/admin";
import { jsonBody, ApiError } from "@/server/api";
import { createSessionToken } from "@/server/auth";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { audit } from "@/server/audit";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = z.object({ email: z.email(), password: z.string().min(1).max(256) }).parse(await jsonBody(request));
    const fingerprints = adminLoginFingerprints(request, input.email);
    enforceAdminLoginRateLimit(fingerprints.ipHash, fingerprints.emailHash);
    if (!safeEqual(input.email.toLowerCase(), env.adminEmail.toLowerCase()) || !safeEqual(input.password, env.adminPassword)) {
      recordAdminLoginAttempt(fingerprints.ipHash, fingerprints.emailHash, false);
      audit({
        request,
        action: "ADMIN_LOGIN_FAILED",
        targetType: "admin_session",
        detail: { emailFingerprint: fingerprints.emailHash },
      });
      throw new ApiError(401, "邮箱或密码不正确", "INVALID_CREDENTIALS");
    }
    recordAdminLoginAttempt(fingerprints.ipHash, fingerprints.emailHash, true);
    const token = await createSessionToken({ userId: "system-admin", scope: "admin" }, "12h");
    const session = { userId: "system-admin", scope: "admin" as const };
    adminAudit(request, session, {
      action: "ADMIN_LOGIN",
      targetType: "admin_session",
      detail: { emailFingerprint: fingerprints.emailHash },
    });
    const response = adminOk({ success: true });
    response.cookies.set("codepool_admin", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: env.isProduction,
      path: "/",
      maxAge: 43_200,
      priority: "high",
    });
    return response;
  } catch (error) {
    return adminFail(error);
  }
}
