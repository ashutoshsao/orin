import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { accountAccess, db, user } from "@repo/db";
import { checkAccess, refundStep, reserveStep } from "./access";

// Runs against the local Postgres (`docker compose up -d`) with a throwaway user — the
// guarantees under test (atomic reserve, CHECK constraint) live in SQL, so a fake DB
// would prove nothing.
const USER_ID = `test-access-${crypto.randomUUID()}`;

async function setAccess(values: Partial<typeof accountAccess.$inferInsert>) {
  await db.delete(accountAccess).where(eq(accountAccess.userId, USER_ID));
  await db.insert(accountAccess).values({ userId: USER_ID, tier: "guest", ...values });
}
const used = async () =>
  (await db.select({ n: accountAccess.stepsUsed }).from(accountAccess).where(eq(accountAccess.userId, USER_ID)))[0]?.n;

beforeEach(async () => {
  await db
    .insert(user)
    .values({ id: USER_ID, name: "access test", email: `${USER_ID}@orin.test` })
    .onConflictDoNothing();
});
afterAll(async () => {
  await db.delete(user).where(eq(user.id, USER_ID)); // cascades the access row
});

describe("reserveStep", () => {
  test("counts up to the limit, then refuses with reason 'steps'", async () => {
    await setAccess({ stepsLimit: 3 });
    for (let i = 0; i < 3; i++) expect(await reserveStep(USER_ID)).toEqual({ ok: true });
    expect(await reserveStep(USER_ID)).toEqual({ ok: false, reason: "steps" });
    expect(await used()).toBe(3);
  });

  test("unlimited never stops, but still counts usage", async () => {
    await setAccess({ tier: "allowlist", stepsLimit: null, stepsUsed: 10_000 });
    expect(await reserveStep(USER_ID)).toEqual({ ok: true });
    expect(await used()).toBe(10_001);
  });

  test("expired access refuses with reason 'expired', even with steps left", async () => {
    await setAccess({ stepsLimit: 60, expiresAt: new Date(Date.now() - 1000) });
    expect(await reserveStep(USER_ID)).toEqual({ ok: false, reason: "expired" });
    expect(await used()).toBe(0);
  });

  test("future expiry still allows", async () => {
    await setAccess({ stepsLimit: 60, expiresAt: new Date(Date.now() + 60_000) });
    expect(await reserveStep(USER_ID)).toEqual({ ok: true });
  });

  test("no access row fails closed with 'no_access'", async () => {
    await db.delete(accountAccess).where(eq(accountAccess.userId, USER_ID));
    expect(await reserveStep(USER_ID)).toEqual({ ok: false, reason: "no_access" });
  });

  test("concurrent requests for the last step: exactly one wins", async () => {
    await setAccess({ stepsLimit: 5, stepsUsed: 4 });
    const results = await Promise.all(Array.from({ length: 10 }, () => reserveStep(USER_ID)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await used()).toBe(5);
  });
});

describe("refundStep", () => {
  test("gives a step back, so a refused account can reserve again", async () => {
    await setAccess({ stepsLimit: 2, stepsUsed: 2 });
    await refundStep(USER_ID);
    expect(await used()).toBe(1);
    expect(await reserveStep(USER_ID)).toEqual({ ok: true });
  });

  test("never goes below zero", async () => {
    await setAccess({ stepsLimit: 2, stepsUsed: 0 });
    await refundStep(USER_ID);
    expect(await used()).toBe(0);
  });
});

describe("checkAccess", () => {
  test("no expiry → ok; past expiry → expired; no row → no_access", async () => {
    await setAccess({ stepsLimit: 60 });
    expect(await checkAccess(USER_ID)).toEqual({ ok: true, limited: true });
    await setAccess({ stepsLimit: 60, expiresAt: new Date(Date.now() - 1000) });
    expect(await checkAccess(USER_ID)).toEqual({ ok: false, reason: "expired" });
    await db.delete(accountAccess).where(eq(accountAccess.userId, USER_ID));
    expect(await checkAccess(USER_ID)).toEqual({ ok: false, reason: "no_access" });
  });

  test("out of steps is still access (read-only use continues)", async () => {
    await setAccess({ stepsLimit: 1, stepsUsed: 1 });
    expect(await checkAccess(USER_ID)).toEqual({ ok: true, limited: true });
  });

  test("unlimited account is not limited", async () => {
    await setAccess({ tier: "allowlist", stepsLimit: null });
    expect(await checkAccess(USER_ID)).toEqual({ ok: true, limited: false });
  });
});
