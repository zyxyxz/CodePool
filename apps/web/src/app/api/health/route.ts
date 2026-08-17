import { NextResponse } from "next/server";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  const timestamp = new Date().toISOString();
  const commit = process.env.CODEPOOL_COMMIT_SHA || "unknown";
  try {
    db.prepare("SELECT 1").get();
    return NextResponse.json(
      { code: 0, data: { status: "ok", service: "codepool", version: "0.3.0", commit, database: "ready", timestamp }, msg: "" },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json(
      { code: 503, data: { status: "error", service: "codepool", version: "0.3.0", commit, database: "unavailable", timestamp }, msg: "服务暂时不可用" },
      { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  }
}
