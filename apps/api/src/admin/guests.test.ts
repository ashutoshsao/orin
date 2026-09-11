import { afterEach, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";
import { accountAccess, db, guestLink, user } from "@repo/db";
import { createGuestLink, listGuestLinks, redeemGuestLink, revokeGuestLink } from "./guests";

const tokenOf = (url: string) => url.split("/g/")[1];
const userIdOf = async (id: string) =>
  (await db.select({ userId: guestLink.userId }).from(guestLink).where(eq(guestLink.id, id)))[0].userId;

afterEach(async () => {
  await db.delete(user).where(like(user.email, "guest-%@guests.orin.invalid")); // cascades link + access
});

describe("guest links", () => {
  test("creates a capped, expiring guest account", async () => {
    const { url, id, expiresAt } = await createGuestLink({ steps: 12, days: 3, label: "Recruiter, Acme" });
    expect(url).toContain("/g/");
    const [access] = await db.select().from(accountAccess).where(eq(accountAccess.userId, await userIdOf(id)));
    expect(access).toMatchObject({ tier: "guest", stepsLimit: 12, stepsUsed: 0 });
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(3);
    expect(await listGuestLinks()).toContainEqual(expect.objectContaining({ id, label: "Recruiter, Acme", stepsLimit: 12 }));
  });

  test("reusable: every visit mints a fresh single-use sign-in URL for the same account", async () => {
    const { url } = await createGuestLink();
    const first = await redeemGuestLink(tokenOf(url));
    const second = await redeemGuestLink(tokenOf(url));
    expect(first?.verifyUrl).toContain("/magic-link/verify");
    expect(second?.verifyUrl).toContain("/magic-link/verify");
    expect(first!.verifyUrl).not.toBe(second!.verifyUrl); // one-time token, reusable link
  });

  test("revoked, expired and unknown links are all refused", async () => {
    const { url, id } = await createGuestLink();
    expect(await revokeGuestLink(id)).toBe(true);
    expect(await redeemGuestLink(tokenOf(url))).toBeNull();
    expect(await revokeGuestLink(id)).toBe(false); // already revoked

    const past = await createGuestLink();
    await db.update(guestLink).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(guestLink.id, past.id));
    expect(await redeemGuestLink(tokenOf(past.url))).toBeNull();

    expect(await redeemGuestLink("not-a-real-token")).toBeNull();
  });
});
