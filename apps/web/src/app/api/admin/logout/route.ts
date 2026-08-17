import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/admin/login", request.url), 303);
  response.cookies.set("codepool_admin", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
