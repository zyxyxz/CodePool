import "server-only";

import { createHmac } from "node:crypto";
import { ApiError } from "./api";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(input: string) {
  const normalized = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new ApiError(400, "TOTP 密钥不是有效的 Base32", "INVALID_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  if (!bytes.length) throw new ApiError(400, "TOTP 密钥不能为空", "INVALID_TOTP_SECRET");
  return Buffer.from(bytes);
}

export function generateTotp(
  secret: string,
  options: { period?: number; digits?: number; algorithm?: string; now?: number } = {},
) {
  const period = options.period || 30;
  const digits = options.digits || 6;
  const now = options.now || Date.now();
  const counter = Math.floor(now / 1000 / period);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const algorithm = (options.algorithm || "SHA1").toLowerCase().replace("sha", "sha") as
    | "sha1"
    | "sha256"
    | "sha512";
  const digest = createHmac(algorithm, decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  const elapsed = Math.floor(now / 1000) % period;
  return { code: binary.toString().padStart(digits, "0"), period, expiresIn: period - elapsed };
}

export function parseOtpAuth(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, "otpauth 链接格式不正确", "INVALID_OTPAUTH_URL");
  }
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
    throw new ApiError(400, "仅支持 TOTP 类型的 otpauth 链接", "UNSUPPORTED_OTP_TYPE");
  }
  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const [labelIssuer, identifier] = label.split(/:(.*)/s);
  const secret = url.searchParams.get("secret");
  if (!secret) throw new ApiError(400, "otpauth 链接缺少 secret", "INVALID_OTPAUTH_URL");
  return {
    secret,
    issuer: url.searchParams.get("issuer") || labelIssuer || "未分类",
    label: identifier || label,
    algorithm: (url.searchParams.get("algorithm") || "SHA1").toUpperCase(),
    digits: Number(url.searchParams.get("digits") || 6),
    period: Number(url.searchParams.get("period") || 30),
  };
}
