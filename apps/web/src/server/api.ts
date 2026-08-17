import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  return NextResponse.json({ code: 0, data, msg: "" }, { ...init, headers });
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errorCode = "REQUEST_FAILED",
    public headers?: HeadersInit,
  ) {
    super(message);
  }
}

export function fail(error: unknown) {
  if (error instanceof ApiError) {
    const headers = new Headers(error.headers);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    return NextResponse.json(
      { code: error.status, data: null, msg: error.message, error: error.errorCode },
      { status: error.status, headers },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { code: 422, data: null, msg: "请求参数不正确", issues: error.issues },
      { status: 422, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json(
      { code: 401, data: null, msg: "登录已失效", error: "UNAUTHORIZED" },
      { status: 401, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
  console.error(error);
  return NextResponse.json(
    { code: 500, data: null, msg: "服务暂时不可用", error: "INTERNAL_ERROR" },
    { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}

export async function jsonBody(request: NextRequest) {
  const maxBytes = 256 * 1024;
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ApiError(413, "请求内容过大", "PAYLOAD_TOO_LARGE");
  }
  if (!request.body) throw new ApiError(400, "请求体必须是 JSON", "INVALID_JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "请求内容过大", "PAYLOAD_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "请求体必须是 JSON", "INVALID_JSON");
  } finally {
    reader.releaseLock();
  }
}
