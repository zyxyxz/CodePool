import "server-only";

import { isIP } from "node:net";
import type { NextRequest } from "next/server";

function normalizeAddress(value: string) {
  let candidate = value.trim().replace(/^"|"$/g, "");
  if (candidate.startsWith("[") && candidate.includes("]")) {
    candidate = candidate.slice(1, candidate.indexOf("]"));
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  return isIP(candidate) ? candidate : null;
}

/**
 * Resolve the address observed by the nearest trusted reverse proxy.
 * The application must not be exposed directly, and every trusted proxy must
 * sanitize/append X-Forwarded-For. Configure the number of trusted hops when
 * more than Dokploy's edge proxy sits in front of the application.
 */
export function requestClientAddress(request: NextRequest) {
  const values = (request.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const configuredHops = Number.parseInt(process.env.CODEPOOL_TRUSTED_PROXY_HOPS || "1", 10);
  const trustedHops = Number.isInteger(configuredHops) && configuredHops >= 1 && configuredHops <= 10
    ? configuredHops
    : 1;
  if (values.length < trustedHops) return null;
  return normalizeAddress(values[values.length - trustedHops]);
}
