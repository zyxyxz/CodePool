import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, jsonBody, ok, ApiError } from "@/server/api";
import { createSessionToken } from "@/server/auth";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";

export async function POST(request: NextRequest) {
  try {
    const input = z.object({ email: z.email(), password: z.string().min(1).max(256) }).parse(await jsonBody(request));
    if (!safeEqual(input.email.toLowerCase(), env.adminEmail.toLowerCase()) || !safeEqual(input.password, env.adminPassword)) {
      throw new ApiError(401, "邮箱或密码不正确", "INVALID_CREDENTIALS");
    }
    const token = await createSessionToken({ userId: "system-admin", scope: "admin" }, "12h");
    const response = ok({ success: true });
    response.cookies.set("codepool_admin", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: env.isProduction,
      path: "/",
      maxAge: 43_200,
    });
    return response;
  } catch (error) {
    return fail(error);
  }
}
