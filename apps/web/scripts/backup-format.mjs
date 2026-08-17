import { createDecipheriv, createHash } from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("CPBK1");
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;

export function deriveBackupKey(backupKey) {
  const unsafe = /^(replace-with|change-me|codepool-(development|dev-only))/i.test(backupKey || "") || new Set(backupKey || "").size < 8;
  if (typeof backupKey !== "string" || backupKey.length < 32 || unsafe) {
    throw new Error("CODEPOOL_BACKUP_KEY must contain at least 32 non-placeholder characters");
  }
  const reusedCoreSecret = [
    process.env.CODEPOOL_JWT_SECRET,
    process.env.CODEPOOL_MASTER_KEY,
    process.env.CODEPOOL_ADMIN_PASSWORD,
  ].some((value) => Boolean(value) && value === backupKey);
  if (reusedCoreSecret) {
    throw new Error("CODEPOOL_BACKUP_KEY must be independent from application and administrator secrets");
  }
  return createHash("sha256").update(backupKey).digest();
}

export async function decryptBackup(file, output, backupKey) {
  const size = fs.statSync(file).size;
  if (size <= HEADER_BYTES) throw new Error("Invalid CodePool backup format");

  const header = Buffer.alloc(HEADER_BYTES);
  const descriptor = fs.openSync(file, "r");
  try {
    const bytesRead = fs.readSync(descriptor, header, 0, HEADER_BYTES, 0);
    if (bytesRead !== HEADER_BYTES || !header.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Invalid CodePool backup format");
    }
  } finally {
    fs.closeSync(descriptor);
  }

  const iv = header.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  const tag = header.subarray(MAGIC.length + IV_BYTES, HEADER_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", deriveBackupKey(backupKey), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      fs.createReadStream(file, { start: HEADER_BYTES }),
      decipher,
      fs.createWriteStream(output, { flags: "wx", mode: 0o600 }),
    );
  } catch (error) {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    throw error;
  }
}

export async function sha256File(file) {
  const digest = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
