import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { adminFail, assertSameOrigin } from "@/server/admin";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    // Keep the redirect relative so reverse-proxy internal hosts such as
    // 0.0.0.0:3000 can never leak into the browser's navigation target.
    const response = new NextResponse(null, {
      status: 303,
      headers: { Location: "/admin/login" },
    });
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
