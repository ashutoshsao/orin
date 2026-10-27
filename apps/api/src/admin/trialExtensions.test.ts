import { afterEach, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { accountAccess, db, guestLink, user } from "@repo/db";
import { requestTrialExtension, extendTrial } from "./trialExtensions";
import { trialRoutes } from "./trialRoutes";
import { usageOverview } from "./usage";

const ids: string[] = [];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
async function fixture(values: Partial<typeof accountAccess.$inferInsert> = {}) {
  const id = `test-extension-${crypto.randomUUID()}`;
  ids.push(id);
  await db.insert(user).values({ id, name: 'trial extension test', email: `${id}@orin.test` });
  await db.insert(accountAccess).values({ userId: id, tier: 'byok', stepsLimit: 60, stepsUsed: 60, expiresAt: daysAgo(1), ...values });
  return id;
}
const accessFor = async (id: string) => (await db.select().from(accountAccess).where(eq(accountAccess.userId, id)))[0]!;
afterEach(async () => { for (const id of ids.splice(0)) await db.delete(user).where(eq(user.id, id)); });

// Exercise the actual routes with injected identity checks, without starting the API,
// its snapshot worker, or its E2B orphan sweep. Production injects Better Auth + requireAdmin.
const app = new Elysia().use(trialRoutes({
  getUserId: async request => request.headers.get('x-test-user'),
  requireAdmin: async request => !request.headers.get('x-test-user')
    ? { ok: false, status: 401 }
    : request.headers.get('x-test-user') === 'admin'
      ? { ok: true }
      : { ok: false, status: 403 },
})).compile();
const post = (path: string, id?: string, body: unknown = {}) => app.handle(new Request(`http://localhost${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(id ? { 'x-test-user': id } : {}) }, body: JSON.stringify(body),
}));

test('expired users can request access repeatedly without receiving budget or losing the original request time', async () => {
  const id = await fixture();
  const first = await requestTrialExtension(id);
  expect(first).toBeInstanceOf(Date);
  expect(await requestTrialExtension(id)).toEqual(first);
  const access = await accessFor(id);
  expect(access.stepsUsed).toBe(60);
  expect(access.stepsLimit).toBe(60);
  expect(access.expiresAt! < new Date()).toBe(true);
});

test('active trials with budget and unlimited accounts cannot request extensions', async () => {
  const active = await fixture({ stepsUsed: 2, expiresAt: daysAgo(-7) });
  const unlimited = await fixture({ tier: 'allowlist', stepsLimit: null });
  expect(await requestTrialExtension(active)).toBeNull();
  expect(await requestTrialExtension(unlimited)).toBeNull();
  expect(await requestTrialExtension('missing-account')).toBeNull();
});

test('admin extension preserves usage, adds 60 steps and 7 days, clears the request and renews guest links', async () => {
  const id = await fixture({ tier: 'guest', dataPurgedAt: new Date() });
  await requestTrialExtension(id);
  const [link] = await db.insert(guestLink).values({ userId: id, tokenHash: crypto.randomUUID(), expiresAt: daysAgo(1) }).returning();
  const [revoked] = await db.insert(guestLink).values({ userId: id, tokenHash: crypto.randomUUID(), expiresAt: daysAgo(1), revokedAt: new Date() }).returning();
  const result = await extendTrial(id);
  const access = await accessFor(id);
  expect(result?.stepsLimit).toBe(120);
  expect(access.stepsUsed).toBe(60);
  expect(access.extensionRequestedAt).toBeNull();
  expect(access.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
  expect(access.dataPurgedAt).toBeInstanceOf(Date); // retained record of the previous cleanup
  expect((await db.select().from(guestLink).where(eq(guestLink.id, link.id)))[0]?.expiresAt).toEqual(access.expiresAt!);
  expect((await db.select().from(guestLink).where(eq(guestLink.id, revoked.id)))[0]?.expiresAt).toEqual(revoked.expiresAt);
});

test('extending an active trial never shortens its existing lifetime', async () => {
  const expiry = daysAgo(-30);
  const id = await fixture({ expiresAt: expiry, stepsUsed: 10 });
  const result = await extendTrial(id);
  expect(result?.expiresAt.getTime()).toBe(expiry.getTime() + 7 * 86_400_000);
  expect((await accessFor(id)).stepsUsed).toBe(10);
});

test('requests appear in the admin overview even after all projects have been cleaned', async () => {
  const id = await fixture({ dataPurgedAt: new Date() });
  await requestTrialExtension(id);
  const row = (await usageOverview()).find(row => row.userId === id);
  expect(row).toMatchObject({ userId: id, projects: 0, stepsUsed: 60 });
  expect(row?.extensionRequestedAt).toBeInstanceOf(Date);
  expect(row?.dataPurgedAt).toBeInstanceOf(Date);
});

test('routes require authentication; extension approval requires admin permission', async () => {
  const id = await fixture();
  expect((await post('/access-request')).status).toBe(401);
  expect((await post(`/admin/users/${id}/extend-trial`)).status).toBe(401);
  expect((await post(`/admin/users/${id}/extend-trial`, id)).status).toBe(403);
  expect((await accessFor(id)).stepsLimit).toBe(60);
  expect((await post(`/admin/users/${id}/extend-trial`, 'admin')).status).toBe(200);
  expect((await accessFor(id)).stepsLimit).toBe(120);
});

test('the access request route uses the signed-in identity and ignores another user ID in its body', async () => {
  const own = await fixture();
  const other = await fixture();
  expect((await post('/access-request', own, { userId: other })).status).toBe(200);
  expect((await accessFor(own)).extensionRequestedAt).toBeInstanceOf(Date);
  expect((await accessFor(other)).extensionRequestedAt).toBeNull();
});
