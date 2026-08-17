import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "./env";

process.umask(0o077);

const migrations = [
  `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    open_id TEXT NOT NULL UNIQUE,
    union_id TEXT,
    nickname TEXT NOT NULL DEFAULT '微信用户',
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'guest')),
    expires_at TEXT,
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS vault_items (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('totp', 'code', 'snippet', 'secret', 'note')),
    title TEXT NOT NULL,
    identifier TEXT,
    language TEXT,
    cipher_text TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    expires_at TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_items_team_updated ON vault_items(team_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_members_user ON team_members(user_id);

  CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    item_id TEXT NOT NULL REFERENCES vault_items(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    max_views INTEGER NOT NULL DEFAULT 1,
    view_count INTEGER NOT NULL DEFAULT 0,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS team_invites (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'member', 'guest')),
    created_by TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT,
    detail TEXT NOT NULL DEFAULT '{}',
    ip_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_audit_team_created ON audit_logs(team_id, created_at DESC);
  `,
  `
  ALTER TABLE users ADD COLUMN disabled_at TEXT;
  ALTER TABLE users ADD COLUMN disabled_reason TEXT;
  ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

  ALTER TABLE teams ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'disabled'));
  ALTER TABLE teams ADD COLUMN disabled_at TEXT;
  ALTER TABLE teams ADD COLUMN disabled_reason TEXT;

  ALTER TABLE vault_items ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'disabled'));
  ALTER TABLE vault_items ADD COLUMN disabled_at TEXT;
  ALTER TABLE vault_items ADD COLUMN disabled_reason TEXT;

  ALTER TABLE team_invites ADD COLUMN revoked_at TEXT;

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_login_attempts (
    id TEXT PRIMARY KEY,
    ip_hash TEXT NOT NULL,
    email_hash TEXT NOT NULL,
    succeeded INTEGER NOT NULL DEFAULT 0 CHECK(succeeded IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS account_deletion_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TEXT,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS api_rate_limits (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_users_status_created
    ON users(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_teams_status_updated
    ON teams(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_items_status_updated
    ON vault_items(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_shares_created
    ON share_links(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_invites_created
    ON team_invites(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_created
    ON audit_logs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_admin_attempts_ip_created
    ON admin_login_attempts(ip_hash, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_admin_attempts_email_created
    ON admin_login_attempts(email_hash, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_deletion_requests_status_created
    ON account_deletion_requests(status, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_deletion_requests_user_created
    ON account_deletion_requests(user_id, requested_at DESC);
  CREATE INDEX IF NOT EXISTS idx_api_rate_limits_reset
    ON api_rate_limits(reset_at);
  `,
  `
  ALTER TABLE account_deletion_requests ADD COLUMN request_note TEXT;
  ALTER TABLE account_deletion_requests ADD COLUMN processor_note TEXT;
  UPDATE account_deletion_requests
  SET request_note = note
  WHERE request_note IS NULL AND status IN ('pending', 'cancelled');
  UPDATE account_deletion_requests
  SET processor_note = note
  WHERE processor_note IS NULL AND status IN ('approved', 'rejected', 'completed');
  `,
];

declare global {
  var __codepoolDb: Database.Database | undefined;
}

function openDatabase() {
  const dataDirectory = path.dirname(env.databasePath);
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  if (env.isProduction) {
    const mode = fs.statSync(dataDirectory).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      const databaseName = path.basename(env.databasePath);
      const directoryIsDedicated = fs.readdirSync(dataDirectory).every((name) =>
        name === databaseName || name.startsWith(`${databaseName}-`) || name === "backups",
      );
      if (!directoryIsDedicated) {
        throw new Error(`Database directory must be private (0700): ${dataDirectory}`);
      }
      fs.chmodSync(dataDirectory, 0o700);
    }
  }
  const instance = new Database(env.databasePath);
  fs.chmodSync(env.databasePath, 0o600);
  instance.pragma("journal_mode = WAL");
  for (const sidecar of [`${env.databasePath}-wal`, `${env.databasePath}-shm`]) {
    if (fs.existsSync(/* turbopackIgnore: true */ sidecar)) {
      fs.chmodSync(/* turbopackIgnore: true */ sidecar, 0o600);
    }
  }
  instance.pragma("foreign_keys = ON");
  instance.pragma("busy_timeout = 5000");
  instance.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  migrations.forEach((sql, index) => {
    const version = index + 1;
    const applied = instance
      .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
      .get(version);
    if (!applied) {
      instance.transaction(() => {
        instance.exec(sql);
        instance.prepare("INSERT INTO schema_migrations(version) VALUES (?)").run(version);
      })();
    }
  });
  return instance;
}

export const db = global.__codepoolDb || openDatabase();
if (!env.isProduction) global.__codepoolDb = db;
