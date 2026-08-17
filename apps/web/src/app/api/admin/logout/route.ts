import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminFail, assertSameOrigin } from "@/server/admin";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.cookies.set("codepool_admin", "", {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return adminFail(error);
  }
}
