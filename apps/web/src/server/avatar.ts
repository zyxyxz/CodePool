import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { ApiError } from "./api";
import { env } from "./env";

export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_AVATAR_JSON_BYTES = 768 * 1024;
const MAX_BASE64_LENGTH = Math.ceil(MAX_AVATAR_BYTES / 3) * 4;
const MAX_INPUT_PIXELS = 16 * 1024 * 1024;
const MAX_AVATAR_DIMENSION = 512;
const AVATAR_CAPABILITY_TTL_SECONDS = 30 * 60;
const avatarSigningKey = createHmac("sha256", env.jwtSecret)
  .update("codepool-avatar-capability-key:v1")
  .digest();

export const avatarPayloadSchema = z.object({
  data: z.string().min(1).max(MAX_BASE64_LENGTH + 64),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
}).strict();

function avatarSignature(userId: string, avatarVersion: number, expiresAt: number) {
  return createHmac("sha256", avatarSigningKey)
    .update(`v1:${userId}:${avatarVersion}:${expiresAt}`)
    .digest();
}

export function signedMemberAvatarUrl(
  userId: string,
  avatarVersion: number,
  storedUrl: string | null | undefined,
) {
  const expectedPath = `/api/v1/avatars/${userId}?v=${avatarVersion}`;
  if (!Number.isSafeInteger(avatarVersion) || avatarVersion < 1 || storedUrl !== expectedPath) {
    return null;
  }
  const expiresAt = Math.floor(Date.now() / 1_000) + AVATAR_CAPABILITY_TTL_SECONDS;
  const signature = avatarSignature(userId, avatarVersion, expiresAt).toString("base64url");
  return `${expectedPath}&exp=${expiresAt}&sig=${signature}`;
}

export function verifyAvatarCapability(input: {
  userId: string;
  avatarVersion: number;
  requestedVersion: string | null;
  expires: string | null;
  signature: string | null;
}) {
  if (input.requestedVersion !== String(input.avatarVersion)) return false;
  if (!input.expires || !/^\d{10}$/.test(input.expires)) return false;
  const expiresAt = Number(input.expires);
  const now = Math.floor(Date.now() / 1_000);
  if (
    !Number.isSafeInteger(expiresAt)
    || expiresAt < now
    || expiresAt > now + AVATAR_CAPABILITY_TTL_SECONDS + 60
  ) {
    return false;
  }
  if (!input.signature || !/^[A-Za-z0-9_-]{43}$/.test(input.signature)) return false;
  const expected = avatarSignature(input.userId, input.avatarVersion, expiresAt);
  const provided = Buffer.from(input.signature, "base64url");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export async function sanitizeAvatar(value: string, declaredMime?: string) {
  const dataUrl = /^data:([^;,]+);base64,(.*)$/s.exec(value);
  const encoded = (dataUrl ? dataUrl[2] : value).replace(/\s/g, "");
  if (
    !encoded
    || encoded.length > MAX_BASE64_LENGTH
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new ApiError(422, "头像数据不是有效的 Base64", "INVALID_AVATAR_DATA");
  }

  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new ApiError(413, "头像大小不能超过 512 KiB", "AVATAR_TOO_LARGE");
  }

  let inputMime: "image/jpeg" | "image/png" | "image/webp" | null = null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    inputMime = "image/jpeg";
  } else if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    inputMime = "image/png";
  } else if (
    bytes.length >= 12
    && bytes.toString("ascii", 0, 4) === "RIFF"
    && bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    inputMime = "image/webp";
  }
  if (!inputMime) {
    throw new ApiError(422, "头像只支持 JPEG、PNG 或 WebP", "UNSUPPORTED_AVATAR_TYPE");
  }
  if (declaredMime && declaredMime !== inputMime) {
    throw new ApiError(422, "头像类型与文件内容不一致", "AVATAR_TYPE_MISMATCH");
  }

  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Image dimensions are missing");
    }
    if ((metadata.pages || 1) > 1) {
      throw new ApiError(422, "不支持动态头像", "ANIMATED_AVATAR_UNSUPPORTED");
    }
    const pipeline = image
      .rotate()
      .resize({
        width: MAX_AVATAR_DIMENSION,
        height: MAX_AVATAR_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      });
    const mime = metadata.hasAlpha ? "image/webp" as const : "image/jpeg" as const;
    const sanitized = mime === "image/webp"
      ? await pipeline.webp({ quality: 84, alphaQuality: 90 }).toBuffer()
      : await pipeline.jpeg({ quality: 86, chromaSubsampling: "4:4:4" }).toBuffer();
    if (!sanitized.length || sanitized.length > MAX_AVATAR_BYTES) {
      throw new ApiError(413, "处理后的头像大小不能超过 512 KiB", "AVATAR_TOO_LARGE");
    }
    return {
      bytes: sanitized,
      mime,
      inputMime,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "头像文件已损坏或尺寸过大", "INVALID_AVATAR_IMAGE");
  }
}
