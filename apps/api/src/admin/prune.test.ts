import { afterEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { accountAccess, db, project, user } from "@repo/db";
import { r2, snapshotKey } from "../persistence/r2";
import { findPruneCandidates, parseAge, prune } from "./prune";

// Local Postgres + the real R2 bucket, under throwaway ids. The guarantee under test is that
// R2 and Postgres go together, which a fake bucket wouldn't prove.
const ids: string[] = [];

async function makeAccount(opts: { tier: string; expiresAt: Date | null; withBundle?: boolean }) {
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
