import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ code: 0, data, msg: "" }, init);
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errorCode = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

export function fail(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { code: error.status, data: null, msg: error.message, error: error.errorCode },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { code: 422, data: null, msg: "请求参数不正确", issues: error.issues },
      { status: 422 },
    );
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json(
      { code: 401, data: null, msg: "登录已失效", error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { code: 500, data: null, msg: "服务暂时不可用", error: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export async function jsonBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "请求体必须是 JSON", "INVALID_JSON");
  }
}
