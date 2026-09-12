import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray, like } from "drizzle-orm";
import { accountAccess, allowlist, db, user } from "@repo/db";

// ADMIN_EMAILS is read when the module loads, so it's set before anything is imported: the
// whole point of these tests is that the gate is server-side, on every route.
const ADMIN = "admin-test@orin.test";
const PLAIN = "plain-test@orin.test";
process.env.ADMIN_EMAILS = ADMIN;

const { auth } = await import("../auth");
await import("../server"); // listens on :4000
const API = "http://localhost:4000";

const cookies: Record<string, string> = {};

beforeAll(async () => {
  for (const email of [ADMIN, PLAIN]) {
    await db.insert(allowlist).values({ email }).onConflictDoNothing();
    const [u] = await db.insert(user).values({ id: `test-${email}`, name: "admin test", email, emailVerified: true }).returning();
    await db.insert(accountAccess).values({ userId: u.id, tier: "allowlist" }).onConflictDoNothing();
    const ctx = await auth.$context;
    const hash = await ctx.password.hash("check-password-123");
    await ctx.internalAdapter.linkAccount({ userId: u.id, providerId: "credential", accountId: u.id, password: hash });
    const res = await auth.api.signInEmail({ body: { email, password: "check-password-123" }, asResponse: true });
    cookies[email] = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  }
});

afterAll(async () => {
  await db.delete(user).where(inArray(user.email, [ADMIN, PLAIN]));
  await db.delete(user).where(like(user.email, "guest-%@guests.orin.invalid"));
  await db.delete(allowlist).where(inArray(allowlist.email, [ADMIN, PLAIN]));
});

const get = (path: string, cookie?: string) => fetch(API + path, { headers: cookie ? { cookie } : {} });
const post = (path: string, body: unknown, cookie?: string) =>
  fetch(API + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

describe("/admin routes", () => {
  test("signed out → 401 on every route", async () => {
    expect((await get("/admin/overview")).status).toBe(401);
    expect((await post("/admin/guest-links", {})).status).toBe(401);
    expect((await post("/admin/invite-links", { email: "x@y.z" })).status).toBe(401);
  });

  test("allowlisted but not an admin → 403 on every route", async () => {
    const c = cookies[PLAIN];
    expect((await get("/admin/overview", c)).status).toBe(403);
    expect((await post("/admin/guest-links", {}, c)).status).toBe(403);
    expect((await post("/admin/invite-links", { email: "x@y.z" }, c)).status).toBe(403);
    expect((await post("/admin/guest-links/any-id/revoke", {}, c)).status).toBe(403);
  });

  test("admin can create and revoke a guest link, and see it in the overview", async () => {
    const c = cookies[ADMIN];
    const made = await post("/admin/guest-links", { label: "Admin test", steps: 3, days: 1 }, c);
    expect(made.status).toBe(200);
    const { url, id } = (await made.json()) as { url: string; id: string };
    expect(url).toContain("/g/");

    const overview = (await (await get("/admin/overview", c)).json()) as { guests: { id: string; label: string | null }[] };
    expect(overview.guests.map((g) => g.id)).toContain(id);

    expect((await post(`/admin/guest-links/${id}/revoke`, {}, c)).status).toBe(200);
    expect((await post(`/admin/guest-links/${id}/revoke`, {}, c)).status).toBe(404); // already revoked
  });

  test("admin sees usage, and /me reports the admin flag", async () => {
    const me = (await (await get("/me", cookies[ADMIN])).json()) as { isAdmin: boolean };
    expect(me.isAdmin).toBe(true);
    const plainMe = (await (await get("/me", cookies[PLAIN])).json()) as { isAdmin: boolean };
    expect(plainMe.isAdmin).toBe(false);

    const { usage } = (await (await get("/admin/overview", cookies[ADMIN])).json()) as { usage: { email: string }[] };
    expect(usage.map((u) => u.email)).toContain(PLAIN);
  });
});
