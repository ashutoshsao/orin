import { afterEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { accountAccess, allowlist, db, project, user, type AccessTier } from "@repo/db";
import { r2, snapshotKey } from "../persistence/r2";
import { findPruneCandidates, parseAge, prune, type PruneStorage } from "./prune";

// Local Postgres + real R2 under throwaway ids for the existing end-to-end tests.
// Failure/retry tests inject storage and Vercel; never delete a real hosted project.
const ids: string[] = [];

async function makeAccount(opts: { tier: AccessTier; expiresAt: Date | null; withBundle?: boolean }) {
  const id = `test-prune-${crypto.randomUUID()}`;
  ids.push(id);
  await db.insert(user).values({ id, name: "prune test", email: `${id}@orin.test` });
  await db.insert(accountAccess).values({ userId: id, tier: opts.tier, stepsLimit: 60, expiresAt: opts.expiresAt });
  const [p] = await db.insert(project).values({ userId: id, name: "prune test" }).returning();
  if (opts.withBundle) await r2.write(snapshotKey("guests", id, p.id, "a".repeat(40)), new Uint8Array([1, 2, 3]));
  return { id, projectId: p.id };
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

afterEach(async () => {
  for (const id of ids.splice(0)) {
    await db.delete(allowlist).where(eq(allowlist.email, `${id}@orin.test`));
    for (const o of (await r2.list({ prefix: `guests/${id}/` })).contents ?? []) await r2.delete(o.key);
    await db.delete(user).where(eq(user.id, id));
  }
  await db.delete(user).where(like(user.email, "test-prune-%@orin.test"));
});

describe("prune-guests", () => {
  test("parseAge understands d/h/m and rejects nonsense", () => {
    expect(parseAge("7d")).toBe(7 * 86_400_000);
    expect(parseAge("36h")).toBe(36 * 3_600_000);
    expect(() => parseAge("soon")).toThrow("bad --older-than");
    expect(() => parseAge("999999999999999999999d")).toThrow("too large");
  });

  test("candidates: expired guests only — not allowlist, not still-valid, not recently expired", async () => {
    const old = await makeAccount({ tier: "guest", expiresAt: daysAgo(30), withBundle: true });
    const recent = await makeAccount({ tier: "byok", expiresAt: daysAgo(1) });
    const live = await makeAccount({ tier: "guest", expiresAt: new Date(Date.now() + 86_400_000) });
    const mine = await makeAccount({ tier: "allowlist", expiresAt: daysAgo(30) });

    const found = await findPruneCandidates(parseAge("7d"));
    const userIds = found.map((c) => c.userId);
    expect(userIds).toContain(old.id);
    expect(userIds).not.toContain(recent.id);
    expect(userIds).not.toContain(live.id);
    expect(userIds).not.toContain(mine.id); // allowlist is never a candidate
    expect(found.find((c) => c.userId === old.id)).toMatchObject({ projects: 1, objects: 1, bytes: 3 });
  });

  test("a dry run deletes nothing", async () => {
    const { id } = await makeAccount({ tier: "guest", expiresAt: daysAgo(30), withBundle: true });
    await findPruneCandidates(parseAge("7d")); // reading is all a dry run does
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(1);
    expect(((await r2.list({ prefix: `guests/${id}/` })).contents ?? []).length).toBe(1);
  });

  test("--yes removes the R2 prefix and the rows together", async () => {
    const { id } = await makeAccount({ tier: "guest", expiresAt: daysAgo(30), withBundle: true });
    const keep = await makeAccount({ tier: "allowlist", expiresAt: daysAgo(30), withBundle: true });

    const candidates = (await findPruneCandidates(parseAge("7d"))).filter((c) => c.userId === id);
    const { deleted, failed } = await prune(candidates);

    expect(failed).toEqual([]);
    expect(deleted.map((d) => d.userId)).toEqual([id]);
    expect(await db.select().from(user).where(eq(user.id, id))).toHaveLength(0);
    expect(await db.select().from(project).where(eq(project.userId, id))).toHaveLength(0); // cascade
    expect(((await r2.list({ prefix: `guests/${id}/` })).contents ?? []).length).toBe(0);
    // The allowlist account is untouched, rows and bundles alike.
    expect(await db.select().from(user).where(eq(user.id, keep.id))).toHaveLength(1);
    expect(((await r2.list({ prefix: `guests/${keep.id}/` })).contents ?? []).length).toBe(1);
  });
});

function memoryStore(keys: string[] = [], pageSize = 1000) {
  const objects = new Set(keys);
  const calls: string[] = [];
  const storage: PruneStorage = {
    list: async ({ prefix, maxKeys, startAfter }) => {
      calls.push('list');
      const all = [...objects].filter(key => key.startsWith(prefix) && (!startAfter || key > startAfter)).sort();
      const page = all.slice(0, Math.min(pageSize, maxKeys));
      return { contents: page.map(key => ({ key, size: 1 })), isTruncated: page.length < all.length };
    },
    delete: async key => { calls.push(`delete:${key}`); objects.delete(key); },
  };
  return { objects, calls, storage };
}

const rowExists = async (id: string) => (await db.select({ id: user.id }).from(user).where(eq(user.id, id))).length > 0;

describe('scheduled cleanup safety and retries', () => {
  test('deletes verified deployments before files and cascades rows only after both succeed', async () => {
    const { id, projectId } = await makeAccount({ tier: 'byok', expiresAt: daysAgo(30) });
    await db.update(project).set({ vercelProject: `app-${projectId}` }).where(eq(project.id, projectId));
    const f = memoryStore([`guests/${id}/app.bundle`]);
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    expect(candidates[0]?.deployments).toBe(1);
    f.calls.length = 0;
    const result = await prune(candidates, { storage: f.storage, vercel: {
      unpublish: async (name, orinProjectId) => {
        expect(name).toBe(`app-${projectId}`);
        expect(orinProjectId).toBe(projectId);
        expect(await rowExists(id)).toBe(true);
        f.calls.push('unpublish');
      },
    } });
    expect(f.calls[0]).toBe('unpublish');
    expect(result.failed).toEqual([]);
    expect(result.deleted).toHaveLength(1);
    expect(f.objects.size).toBe(0);
    expect(await rowExists(id)).toBe(false);
  });

  test('provider failures preserve all files and DB references for retry', async () => {
    const { id, projectId } = await makeAccount({ tier: 'guest', expiresAt: daysAgo(30) });
    await db.update(project).set({ vercelProject: `app-${projectId}` }).where(eq(project.id, projectId));
    const f = memoryStore([`guests/${id}/app.bundle`]);
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    f.calls.length = 0;
    const result = await prune(candidates, { storage: f.storage, vercel: {
      unpublish: async () => { throw new Error('provider unavailable'); },
    } });
    expect(result.failed[0]?.message).toContain('provider unavailable');
    expect(await rowExists(id)).toBe(true);
    expect(f.objects.size).toBe(1);
    expect(f.calls).toEqual([]);
    expect((await db.select().from(project).where(eq(project.id, projectId)))[0]?.vercelProject).toBe(`app-${projectId}`);
  });

  test('missing Vercel credentials block deletion when an account has hosted resources', async () => {
    const { id, projectId } = await makeAccount({ tier: 'guest', expiresAt: daysAgo(30) });
    await db.update(project).set({ vercelProject: `app-${projectId}` }).where(eq(project.id, projectId));
    const f = memoryStore([`guests/${id}/app.bundle`]);
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    const result = await prune(candidates, { storage: f.storage, vercel: null });
    expect(result.failed[0]?.message).toContain('unconfigured');
    expect(await rowExists(id)).toBe(true);
    expect(f.objects.size).toBe(1);
  });

  test('partial file deletion retains rows and succeeds on retry, including all listing pages', async () => {
    const { id, projectId } = await makeAccount({ tier: 'guest', expiresAt: daysAgo(30) });
    await db.update(project).set({ vercelProject: `app-${projectId}` }).where(eq(project.id, projectId));
    const f = memoryStore(['a', 'b', 'c', 'd', 'e'].map(x => `guests/${id}/${x}.bundle`), 2);
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    expect(candidates[0]?.objects).toBe(5);
    let unpublishAttempts = 0;
    const vercel = { unpublish: async () => { unpublishAttempts++; } };
    const remove = f.storage.delete;
    let attempts = 0;
    f.storage.delete = async key => {
      if (++attempts === 2) throw new Error('R2 unavailable');
      return remove(key);
    };
    const first = await prune(candidates, { storage: f.storage, vercel });
    expect(first.failed[0]?.message).toContain('R2 unavailable');
    expect(await rowExists(id)).toBe(true);
    expect(f.objects.size).toBe(4);
    f.storage.delete = remove;
    const second = await prune(candidates, { storage: f.storage, vercel });
    expect(second.failed).toEqual([]);
    expect(second.deleted).toHaveLength(1);
    expect(f.objects.size).toBe(0);
    expect(await rowExists(id)).toBe(false);
    expect(unpublishAttempts).toBe(2); // deployment may already be gone when a retry begins
  });

  test('one failed account does not block cleanup of the remaining accounts', async () => {
    const first = await makeAccount({ tier: 'guest', expiresAt: daysAgo(30) });
    const second = await makeAccount({ tier: 'byok', expiresAt: daysAgo(30) });
    await db.update(project).set({ vercelProject: `app-${first.projectId}` }).where(eq(project.id, first.projectId));
    const f = memoryStore([`guests/${first.id}/app.bundle`, `guests/${second.id}/app.bundle`]);
    const found = await findPruneCandidates(parseAge('7d'), f.storage);
    const candidates = [found.find(c => c.userId === first.id)!, found.find(c => c.userId === second.id)!];
    const result = await prune(candidates, { storage: f.storage, vercel: {
      unpublish: async () => { throw new Error('ownership mismatch'); },
    } });
    expect(result.failed.map(c => c.userId)).toEqual([first.id]);
    expect(result.deleted.map(c => c.userId)).toEqual([second.id]);
    expect(await rowExists(first.id)).toBe(true);
    expect(await rowExists(second.id)).toBe(false);
    expect([...f.objects]).toEqual([`guests/${first.id}/app.bundle`]);
  });

  test('a stale candidate cannot delete a renewed, promoted, unlimited or newly allowlisted account', async () => {
    for (const change of ['renewed', 'promoted', 'unlimited', 'allowlisted']) {
      const { id } = await makeAccount({ tier: 'guest', expiresAt: daysAgo(30) });
      const f = memoryStore([`guests/${id}/app.bundle`]);
      const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
      if (change === 'renewed') await db.update(accountAccess).set({ expiresAt: daysAgo(-1) }).where(eq(accountAccess.userId, id));
      if (change === 'promoted') await db.update(accountAccess).set({ tier: 'allowlist' }).where(eq(accountAccess.userId, id));
      if (change === 'unlimited') await db.update(accountAccess).set({ stepsLimit: null }).where(eq(accountAccess.userId, id));
      if (change === 'allowlisted') await db.insert(allowlist).values({ email: `${id}@orin.test` });
      const result = await prune(candidates, { storage: f.storage, vercel: null });
      expect(result.skipped).toHaveLength(1);
      expect(result.failed).toEqual([]);
      expect(await rowExists(id)).toBe(true);
      expect(f.objects.size).toBe(1);
      expect((await findPruneCandidates(parseAge('7d'), f.storage)).some(c => c.userId === id)).toBe(false);
    }
  });

  test('the actual retention option is rechecked instead of silently using seven days', async () => {
    const { id } = await makeAccount({ tier: 'guest', expiresAt: daysAgo(10) });
    const f = memoryStore();
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    const result = await prune(candidates, { olderThanMs: parseAge('30d'), storage: f.storage, vercel: null });
    expect(result.skipped).toHaveLength(1);
    expect(await rowExists(id)).toBe(true);
  });

  test('cleans a downgraded account’s old storage scope without touching another owner', async () => {
    const { id } = await makeAccount({ tier: 'byok', expiresAt: daysAgo(30) });
    const keep = await makeAccount({ tier: 'allowlist', expiresAt: daysAgo(30) });
    const f = memoryStore([`guests/${id}/current.bundle`, `users/${id}/old.bundle`, `users/${keep.id}/keep.bundle`]);
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    expect(candidates[0]?.objects).toBe(2);
    const result = await prune(candidates, { storage: f.storage, vercel: null });
    expect(result.deleted).toHaveLength(1);
    expect([...f.objects]).toEqual([`users/${keep.id}/keep.bundle`]);
    expect(await rowExists(keep.id)).toBe(true);
  });

  test('overlapping cleanup runs delete an account once', async () => {
    const { id } = await makeAccount({ tier: 'guest', expiresAt: daysAgo(30) });
    const f = memoryStore([`guests/${id}/app.bundle`]);
    const candidates = (await findPruneCandidates(parseAge('7d'), f.storage)).filter(c => c.userId === id);
    const results = await Promise.all([prune(candidates, { storage: f.storage }), prune(candidates, { storage: f.storage })]);
    expect(results.flatMap(r => r.deleted)).toHaveLength(1);
    expect(results.flatMap(r => r.skipped)).toHaveLength(1);
    expect(results.flatMap(r => r.failed)).toEqual([]);
    expect(f.calls.filter(c => c.startsWith('delete:'))).toHaveLength(1);
  });
});
