import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { deriveBackupKey, sha256File } from "./backup-format.mjs";

process.umask(0o077);

const source = path.resolve(process.env.CODEPOOL_DATABASE_PATH || "./data/codepool.db");
const destination = path.resolve(process.env.CODEPOOL_BACKUP_DIR || "./data/backups");
const backupKey = process.env.CODEPOOL_BACKUP_KEY || "";

if (!fs.existsSync(source)) throw new Error(`Database does not exist: ${source}`);
const key = deriveBackupKey(backupKey);

fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
fs.chmodSync(destination, 0o700);
for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith(".codepool-backup-")) continue;
  const staleDirectory = path.join(destination, entry.name);
  if (Date.now() - fs.statSync(staleDirectory).mtimeMs < 24 * 60 * 60 * 1_000) continue;
  for (const name of ["snapshot.sqlite", "snapshot.sqlite-wal", "snapshot.sqlite-shm"]) {
    const staleFile = path.join(staleDirectory, name);
    if (fs.existsSync(staleFile)) fs.unlinkSync(staleFile);
  }
  try { fs.rmdirSync(staleDirectory); } catch { /* keep unexpected files for manual review */ }
}
const sourceBytes = fs.statSync(source).size + (fs.existsSync(`${source}-wal`) ? fs.statSync(`${source}-wal`).size : 0);
const requiredBytes = sourceBytes * 2 + 64 * 1024 * 1024;
const filesystem = fs.statfsSync(destination);
const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
if (availableBytes < requiredBytes) {
  throw new Error(`Insufficient backup space: need at least ${requiredBytes} bytes, only ${availableBytes} bytes available`);
}
const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const temporaryDirectory = fs.mkdtempSync(path.join(destination, ".codepool-backup-"));
fs.chmodSync(temporaryDirectory, 0o700);
const snapshot = path.join(temporaryDirectory, "snapshot.sqlite");
const partialOutput = path.join(destination, `.codepool-${stamp}.cpbak.partial`);
const output = path.join(destination, `codepool-${stamp}.cpbak`);
let database;
let completed = false;

try {
  database = new Database(source, { readonly: true });
  await database.backup(snapshot);
  fs.chmodSync(snapshot, 0o600);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  fs.writeFileSync(
    partialOutput,
    Buffer.concat([Buffer.from("CPBK1"), iv, Buffer.alloc(16)]),
    { flag: "wx", mode: 0o600 },
  );
  await pipeline(
    fs.createReadStream(snapshot),
    cipher,
    fs.createWriteStream(partialOutput, { flags: "r+", start: 33 }),
  );
  const tag = cipher.getAuthTag();
  const partialDescriptor = fs.openSync(partialOutput, "r+");
  try {
    fs.writeSync(partialDescriptor, tag, 0, tag.length, 17);
    fs.fsyncSync(partialDescriptor);
  } finally {
    fs.closeSync(partialDescriptor);
  }
  fs.renameSync(partialOutput, output);
  const digest = await sha256File(output);
  completed = true;
  process.stdout.write(JSON.stringify({ ok: true, file: output, bytes: fs.statSync(output).size, sha256: digest, createdAt: new Date().toISOString() }) + "\n");
} finally {
  if (database) database.close();
  for (const temporaryFile of [snapshot, `${snapshot}-wal`, `${snapshot}-shm`, partialOutput]) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
  if (fs.existsSync(temporaryDirectory)) fs.rmdirSync(temporaryDirectory);
  if (!completed && fs.existsSync(output)) fs.unlinkSync(output);
}
