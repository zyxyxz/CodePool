import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { decryptBackup } from "./backup-format.mjs";

process.umask(0o077);

const positional = process.argv.slice(2).filter((argument) => argument !== "--force");
const force = process.argv.slice(2).includes("--force");
const backupFile = positional[0] ? path.resolve(positional[0]) : "";
const configuredTarget = positional[1] || process.env.CODEPOOL_DATABASE_PATH || "./data/codepool.db";
const target = path.resolve(configuredTarget);
const backupKey = process.env.CODEPOOL_BACKUP_KEY || "";

if (!backupFile || !fs.existsSync(backupFile)) {
  throw new Error("Usage: npm run db:restore -- /absolute/path/to/file.cpbak [/absolute/path/to/codepool.db] [--force]");
}
if (backupFile === target) throw new Error("Backup file and restore target must be different files");
if (fs.existsSync(target) && !force) {
  throw new Error(`Restore target already exists: ${target}. Stop the application and pass --force to retain and replace it.`);
}

fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const temporary = path.join(
  path.dirname(target),
  `.${path.basename(target)}.restore-${process.pid}-${Date.now()}`,
);
let database;
let restored = false;
const movedFiles = [];

try {
  await decryptBackup(backupFile, temporary, backupKey);
  database = new Database(temporary, { readonly: true, fileMustExist: true });
  database.pragma("query_only = ON");
  const integrity = database.pragma("integrity_check", { simple: true });
  const migration = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
  database.close();
  database = undefined;
  if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity}`);

  for (const temporarySidecar of [`${temporary}-wal`, `${temporary}-shm`]) {
    if (fs.existsSync(temporarySidecar)) fs.unlinkSync(temporarySidecar);
  }

  const recoveryStamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  try {
    for (const current of [target, `${target}-wal`, `${target}-shm`]) {
      if (!fs.existsSync(current)) continue;
      const retained = `${current}.pre-restore-${recoveryStamp}`;
      fs.renameSync(current, retained);
      movedFiles.push({ current, retained });
    }
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
    restored = true;
  } catch (error) {
    for (const moved of movedFiles.toReversed()) {
      if (!fs.existsSync(moved.current) && fs.existsSync(moved.retained)) {
        fs.renameSync(moved.retained, moved.current);
      }
    }
    throw error;
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    target,
    integrity,
    schemaVersion: migration.version,
    retainedPreviousFiles: movedFiles.map((entry) => entry.retained),
  }) + "\n");
} finally {
  if (database) database.close();
  for (const temporaryFile of [temporary, `${temporary}-wal`, `${temporary}-shm`]) {
    if (!restored && fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}
