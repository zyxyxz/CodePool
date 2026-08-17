import { ok } from "@/server/api";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  db.prepare("SELECT 1").get();
  return ok({ status: "ok", service: "codepool", version: "0.2.0", timestamp: new Date().toISOString() });
}
