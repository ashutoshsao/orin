import { and, eq, inArray, isNotNull, isNull, lt, notExists, or, sql } from "drizzle-orm";
import { accountAccess, allowlist, db, project, user } from "@repo/db";
import { vercelFromEnv, type VercelClient } from "../deploy/vercel";
import { r2 } from "../persistence/r2";

// CLI and scheduled cleanup share this code. Keep expired trial data for another
// seven days; never prune unlimited accounts. External deletes precede the DB delete
// so a failure leaves the resource references available for the next run to retry.
// Keep the user, sign-in identity and access/usage history after project cleanup.
export const PRUNE_RETENTION = "7d";

export type PruneCandidate = {
  userId: string;
  email: string;
  tier: string;
  expiredAt: Date;
  projects: number;
  deployments: number;
  objects: number;
  bytes: number;
};

export type PruneResult = {
  deleted: PruneCandidate[];
  skipped: PruneCandidate[];
  failed: { userId: string; message: string }[];
};

// Only these operations are exposed to tests; production uses the configured R2 bucket.
export type PruneStorage = {
  list: (opts: { prefix: string; maxKeys: number; startAfter?: string }) => Promise<{
    contents?: { key: string; size?: number }[];
    isTruncated?: boolean;
  }>;
  delete: (key: string) => Promise<unknown>;
};
type PruneOptions = {
  olderThanMs?: number;
  storage?: PruneStorage;
  vercel?: Pick<VercelClient, "unpublish"> | null;
};

// "7d" / "36h" / "90m" → milliseconds.
export function parseAge(spec: string): number {
  const m = /^(\d+)\s*([dhm])$/.exec(spec.trim());
  if (!m) throw new Error(`bad --older-than: ${spec} (use 7d, 36h, 90m)`);
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2] as "d" | "h" | "m"];
  const age = Number(m[1]) * unit;
  if (!Number.isSafeInteger(age)) throw new Error("--older-than is too large");
  return age;
}

function cutoffFor(olderThanMs: number) {
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) throw new Error("retention must be a non-negative duration");
  const cutoff = new Date(Date.now() - olderThanMs);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("retention is too large");
  return cutoff;
}

// A downgraded account may still have bundles from when it was unlimited.
// Both prefixes are scoped to the same revalidated owner, never another account.
const accountPrefixes = (userId: string) => [`guests/${userId}/`, `users/${userId}/`];

async function measure(userId: string, storage: PruneStorage): Promise<{ objects: number; bytes: number }> {
  let objects = 0;
  let bytes = 0;
  for (const prefix of accountPrefixes(userId)) {
    let after: string | undefined;
    for (;;) {
      const page = await storage.list({ prefix, maxKeys: 1000, startAfter: after });
      for (const o of page.contents ?? []) {
        objects++;
        bytes += o.size ?? 0;
      }
      if (!page.isTruncated || !page.contents?.length) break;
      after = page.contents.at(-1)!.key;
    }
  }
  return { objects, bytes };
}

// Preview only: no provider calls that delete anything. An allowlisted email is also
// protected when its access row has not yet been upgraded to the allowlist tier.
export async function findPruneCandidates(olderThanMs: number, storage: PruneStorage = r2): Promise<PruneCandidate[]> {
  const cutoff = cutoffFor(olderThanMs);
  const rows = await db
    .select({ userId: accountAccess.userId, email: user.email, tier: accountAccess.tier, expiredAt: accountAccess.expiresAt })
    .from(accountAccess)
    .innerJoin(user, eq(user.id, accountAccess.userId))
    .where(and(
      inArray(accountAccess.tier, ["guest", "byok"]),
      isNotNull(accountAccess.stepsLimit),
      isNotNull(accountAccess.expiresAt),
      lt(accountAccess.expiresAt, cutoff),
      or(isNull(accountAccess.dataPurgedAt), lt(accountAccess.dataPurgedAt, accountAccess.expiresAt)),
      notExists(db.select().from(allowlist).where(eq(allowlist.email, sql`lower(${user.email})`))),
    ));

  const out: PruneCandidate[] = [];
  for (const row of rows) {
    const projects = await db.select({ id: project.id, vercelProject: project.vercelProject }).from(project).where(eq(project.userId, row.userId));
    const { objects, bytes } = await measure(row.userId, storage);
    out.push({ ...row, expiredAt: row.expiredAt!, projects: projects.length, deployments: projects.filter(p => p.vercelProject !== null).length, objects, bytes });
  }
  return out;
}

export async function prune(candidates: PruneCandidate[], opts: PruneOptions = {}): Promise<PruneResult> {
  const olderThanMs = opts.olderThanMs ?? parseAge(PRUNE_RETENTION);
  cutoffFor(olderThanMs);
  const storage = opts.storage ?? r2;
  const vercel = opts.vercel === undefined ? vercelFromEnv() : opts.vercel;
  const deleted: PruneCandidate[] = [];
  const skipped: PruneCandidate[] = [];
  const failed: PruneResult["failed"] = [];
  for (const c of candidates) {
    try {
      const removed = await db.transaction(async (tx) => {
        // Revalidate inside locks: a stale preview must not delete an account that
        // was renewed or promoted. Concurrent prune invocations serialize here.
        // Locking the user also blocks new projects during resource cleanup.
        const [owner] = await tx.select({ email: user.email }).from(user).where(eq(user.id, c.userId)).for("update");
        if (!owner) return false;
        const [access] = await tx.select().from(accountAccess).where(eq(accountAccess.userId, c.userId)).for("update");
        if (!access || !["guest", "byok"].includes(access.tier) || access.stepsLimit === null ||
            !access.expiresAt || access.expiresAt >= cutoffFor(olderThanMs) ||
            (access.dataPurgedAt && access.dataPurgedAt >= access.expiresAt)) return false;
        const [listed] = await tx.select().from(allowlist).where(eq(allowlist.email, owner.email.toLowerCase()));
        if (listed) return false;

        const projects = await tx.select({ id: project.id, vercelProject: project.vercelProject }).from(project)
          .where(eq(project.userId, c.userId)).for("update");
        for (const p of projects) {
          if (!p.vercelProject) continue;
          if (!vercel) throw new Error("Vercel cleanup is unconfigured; account and files kept");
          // Resolves an immutable ID, checks Orin ownership metadata, and accepts
          // remote 404s. A retry after a partial cleanup can safely repeat this.
          await vercel.unpublish(p.vercelProject, p.id);
        }

        for (const prefix of accountPrefixes(c.userId)) {
          let after: string | undefined;
          for (;;) {
            const page = await storage.list({ prefix, maxKeys: 1000, startAfter: after });
            const keys = (page.contents ?? []).map(o => o.key);
            for (const key of keys) await storage.delete(key);
            if (!page.isTruncated || keys.length === 0) break;
            after = keys.at(-1);
          }
        }
        // Remove project history, but preserve the account, linked sign-in identity,
        // guest link and spent step budget. Signing in again must not reset a trial.
        await tx.delete(project).where(eq(project.userId, c.userId));
        await tx.update(accountAccess).set({ dataPurgedAt: new Date() }).where(eq(accountAccess.userId, c.userId));
        return true;
      });
      (removed ? deleted : skipped).push(c);
    } catch (e) {
      failed.push({ userId: c.userId, message: String(e) });
    }
  }
  return { deleted, skipped, failed };
}
