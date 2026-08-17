import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { decryptBackup } from "./backup-format.mjs";

process.umask(0o077);

const file = process.argv[2] ? path.resolve(process.argv[2]) : "";
const backupKey = process.env.CODEPOOL_BACKUP_KEY || "";
if (!file || !fs.existsSync(file)) throw new Error("Usage: npm run db:verify-backup -- /absolute/path/to/file.cpbak");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codepool-verify-"));
const snapshot = path.join(tempDir, "backup.sqlite");
let database;

try {
  await decryptBackup(file, snapshot, backupKey);
  database = new Database(snapshot, { readonly: true, fileMustExist: true });
  database.pragma("query_only = ON");
  const integrity = database.pragma("integrity_check", { simple: true });
  const migrations = database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get();
  const tables = database.prepare("SELECT COUNT(*) AS value FROM sqlite_master WHERE type = 'table'").get();
  database.close();
  database = undefined;
  if (integrity !== "ok") throw new Error(`Backup integrity check failed: ${integrity}`);
  process.stdout.write(JSON.stringify({ ok: true, file, integrity, schemaVersion: migrations.version, tables: tables.value }) + "\n");
} finally {
  if (database) database.close();
  for (const temporaryFile of [snapshot, `${snapshot}-wal`, `${snapshot}-shm`]) {
    if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
  fs.rmdirSync(tempDir);
}
