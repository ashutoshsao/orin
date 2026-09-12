import { S3Client } from "bun";

// R2 is S3-compatible, so Bun's built-in S3Client talks to it with no extra deps
// (matches the Bun.redis / Bun.sql conventions in apps/api/CLAUDE.md). Credentials
// come from apps/api/.env; a new Orin-only token/bucket, isolated from other projects.
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`env ${name} not set (needed for R2 snapshots)`);
  return value;
}

export const r2 = new S3Client({
  accessKeyId: env("R2_ACCESS_KEY_ID"),
  secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
  bucket: env("R2_BUCKET"),
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
});

// Codebase snapshots live under a per-user, per-project prefix; the commit hash names
// the object so a project can hold many snapshots and the DB just points at the latest.
// Limited tiers (guest / BYOK) live under `guests/` so a prune can delete one prefix and be
// sure it touched nobody's permanent work (7a/7d). Allowlist accounts stay under `users/`.
export type KeyScope = "users" | "guests";

export function snapshotPrefix(scope: KeyScope, userId: string, projectId: string): string {
  return `${scope}/${userId}/projects/${projectId}/snapshots/`;
}

export function snapshotKey(scope: KeyScope, userId: string, projectId: string, commitHash: string): string {
  return `${snapshotPrefix(scope, userId, projectId)}${commitHash}.bundle`;
}

// The folder a key sits in — pruning reads it off the key rather than re-deriving the scope,
// so bundles written under an older scope are still found.
export const prefixOf = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);
