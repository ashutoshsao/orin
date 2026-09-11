import { afterEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { accountAccess, allowlist, db, invite, user } from "@repo/db";
import { auth } from "../auth";
import { acceptInvite, createInviteLink, peekInvite } from "./invites";

// Local Postgres + the real Better Auth context: the point of these tests is that an
// account created this way can actually sign in, which a fake would not prove.
const EMAIL = "invite-test@orin.test";
const PASSWORD = "check-password-123";
const tokenOf = (url: string) => url.split("/invite/")[1];
const signIn = (password: string) =>
  auth.api.signInEmail({ body: { email: EMAIL, password } }).then(() => true, () => false);

afterEach(async () => {
  await db.delete(user).where(inArray(user.email, [EMAIL]));
  await db.delete(allowlist).where(eq(allowlist.email, EMAIL));
  await db.delete(invite).where(eq(invite.email, EMAIL));
});

describe("invite links", () => {
  test("invite link creates an allowlisted, unlimited account that can sign in", async () => {
    const { url } = await createInviteLink(EMAIL);
    expect(await peekInvite(tokenOf(url))).toEqual({ email: EMAIL, kind: "invite" });

    expect(await acceptInvite(tokenOf(url), PASSWORD)).toEqual({ email: EMAIL, kind: "invite" });
    expect(await signIn(PASSWORD)).toBe(true);

    const [u] = await db.select().from(user).where(eq(user.email, EMAIL));
    const [access] = await db.select().from(accountAccess).where(eq(accountAccess.userId, u.id));
    expect(access).toMatchObject({ tier: "allowlist", stepsLimit: null, expiresAt: null });
  });

  test("a used link is dead, and unknown/expired links look the same", async () => {
    const { url } = await createInviteLink(EMAIL);
    await acceptInvite(tokenOf(url), PASSWORD);
    expect(acceptInvite(tokenOf(url), PASSWORD)).rejects.toThrow("expired or was already used");
    expect(await peekInvite(tokenOf(url))).toBeNull();
    expect(await peekInvite("not-a-real-token")).toBeNull();
  });

  test("two clicks race: only one accept wins", async () => {
    const { url } = await createInviteLink(EMAIL);
    const results = await Promise.allSettled([acceptInvite(tokenOf(url), PASSWORD), acceptInvite(tokenOf(url), PASSWORD)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  test("issuing a new link burns the previous unused one", async () => {
    const first = await createInviteLink(EMAIL);
    const second = await createInviteLink(EMAIL);
    expect(await peekInvite(tokenOf(first.url))).toBeNull();
    expect(await peekInvite(tokenOf(second.url))).not.toBeNull();
  });

  test("a short password is refused and does not burn the link", async () => {
    const { url } = await createInviteLink(EMAIL);
    expect(acceptInvite(tokenOf(url), "short")).rejects.toThrow("at least");
    expect(await peekInvite(tokenOf(url))).not.toBeNull();
  });

  test("reset link replaces the password; invite link refuses an existing account", async () => {
    await acceptInvite(tokenOf((await createInviteLink(EMAIL)).url), PASSWORD);
    expect(createInviteLink(EMAIL)).rejects.toThrow("already has an account");

    const reset = await createInviteLink(EMAIL, "reset");
    await acceptInvite(tokenOf(reset.url), "a-brand-new-password");
    expect(await signIn("a-brand-new-password")).toBe(true);
    expect(await signIn(PASSWORD)).toBe(false);
  });

  test("reset link for an unknown account is refused", async () => {
    expect(createInviteLink("nobody@orin.test", "reset")).rejects.toThrow("no account");
  });

  test("open email sign-up stays disabled", async () => {
    await db.insert(allowlist).values({ email: EMAIL }).onConflictDoNothing();
    expect(
      auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: "squatter" } }),
    ).rejects.toThrow();
  });
});
