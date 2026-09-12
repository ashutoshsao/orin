import { and, eq, isNotNull, lt, ne } from "drizzle-orm";
import { accountAccess, db, project, user } from "@repo/db";
import { r2 } from "../persistence/r2";

// Manual prune of limited-tier accounts (7d). Access expiry is automatic; deletion is NOT —
// no CronJob, no R2 lifecycle rule. Guest data is small, and deletion bugs are the ones you
// can't undo, so this runs by hand, dry by default.
//
// R2 and Postgres go together or not at all: a bundle deleted under a kept conversation
// would restore a bare template beneath history describing code that no longer exists. So
// each account's objects are removed first and its rows only if that succeeded.

export type PruneCandidate = {
  userId: string;
  email: string;
  tier: string;
  expiredAt: Date;
  projects: number;
  objects: number;
  bytes: number;
};

export type PruneResult = { deleted: PruneCandidate[]; failed: { userId: string; message: string }[] };

// "7d" / "36h" / "90m" → milliseconds.
export function parseAge(spec: string): number {
  const m = /^(\d+)\s*([dhm])$/.exec(spec.trim());
  if (!m) throw new Error(`bad --older-than: ${spec} (use 7d, 36h, 90m)`);
  const unit = { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2] as "d" | "h" | "m"];
  return Number(m[1]) * unit;
}

const guestPrefix = (userId: string) => `guests/${userId}/`;

async function measure(userId: string): Promise<{ objects: number; bytes: number }> {
  let objects = 0;
  let bytes = 0;
  let after: string | undefined;
  for (;;) {
    const page = await r2.list({ prefix: guestPrefix(userId), maxKeys: 1000, startAfter: after });
    for (const o of page.contents ?? []) {
      objects++;
      bytes += o.size ?? 0;
    }
    if (!page.isTruncated || !page.contents?.length) return { objects, bytes };
    after = page.contents.at(-1)!.key;
  }
}

// Limited-tier accounts whose access expired longer ago than `olderThanMs`. Allowlist
// accounts are excluded in SQL, not by a later filter — they must never be candidates.
export async function findPruneCandidates(olderThanMs: number): Promise<PruneCandidate[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .select({ userId: accountAccess.userId, email: user.email, tier: accountAccess.tier, expiredAt: accountAccess.expiresAt })
    .from(accountAccess)
    .innerJoin(user, eq(user.id, accountAccess.userId))
    .where(and(ne(accountAccess.tier, "allowlist"), isNotNull(accountAccess.expiresAt), lt(accountAccess.expiresAt, cutoff)));

  const out: PruneCandidate[] = [];
  for (const row of rows) {
    const projects = await db.select({ id: project.id }).from(project).where(eq(project.userId, row.userId));
    const { objects, bytes } = await measure(row.userId);
    out.push({ ...row, expiredAt: row.expiredAt!, projects: projects.length, objects, bytes });
  }
  return out;
}

// Delete for real: R2 objects first, then the user row (cascades access, projects, messages,
// snapshots, guest links). An account whose R2 delete fails keeps ALL its rows.
export async function prune(candidates: PruneCandidate[]): Promise<PruneResult> {
  const deleted: PruneCandidate[] = [];
  const failed: PruneResult["failed"] = [];
  for (const c of candidates) {
    try {
      let after: string | undefined;
      for (;;) {
        const page = await r2.list({ prefix: guestPrefix(c.userId), maxKeys: 1000, startAfter: after });
        const keys = (page.contents ?? []).map((o) => o.key);
        for (const key of keys) await r2.delete(key);
        if (!page.isTruncated || keys.length === 0) break;
        after = keys.at(-1);
      }
      await db.delete(user).where(eq(user.id, c.userId));
      deleted.push(c);
    } catch (e) {
      failed.push({ userId: c.userId, message: String(e) });
    }
  }
  return { deleted, failed };
}
