import "server-only";

import type { Role } from "./access";
import { decrypt } from "./crypto";

export type ItemRow = {
  id: string;
  team_id: string;
  kind: "totp" | "code" | "snippet" | "secret" | "note";
  title: string;
  identifier: string | null;
  language: string | null;
  cipher_text: string;
  iv: string;
  auth_tag: string;
  metadata: string;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  role?: Role;
};

export function itemSummary(row: ItemRow) {
  const metadata = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
  return {
    id: row.id,
    teamId: row.team_id,
    kind: row.kind,
    title: row.title,
    identifier: row.identifier,
    language: row.language,
    metadata,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function revealItem(row: ItemRow) {
  return {
    ...itemSummary(row),
    content: decrypt({ cipherText: row.cipher_text, iv: row.iv, authTag: row.auth_tag }),
  };
}

export function accountSummary(row: ItemRow) {
  const summary = itemSummary(row);
  const metadata = summary.metadata as {
    issuer?: string;
    label?: string;
    algorithm?: string;
    digits?: number;
    period?: number;
    remark?: string;
  };
  return {
    id: row.id,
    teamId: row.team_id,
    team_id: row.team_id,
    issuer: metadata.issuer || row.title,
    label: metadata.label || row.identifier || row.title,
    accountIdentifier: row.identifier,
    account_identifier: row.identifier,
    algorithm: metadata.algorithm || "SHA1",
    digits: metadata.digits || 6,
    period: metadata.period || 30,
    remark: metadata.remark || null,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}
