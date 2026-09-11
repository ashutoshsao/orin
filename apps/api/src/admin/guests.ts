import { and, desc, eq, isNull } from "drizzle-orm";
import { accountAccess, db, guestLink, user } from "@repo/db";
import { auth, magicLinkCapture, WEB_ORIGIN } from "../auth";
import { TRIAL_DAYS, TRIAL_STEPS } from "../persistence/access";

// Guest links (7c): one account behind a reusable link you send to someone. Every visit —
// any device, any number of opens — signs into that same account, so its 60 steps are the
// whole cost of sharing the link. Shared by the CLI and (7g) the admin page.

const sha256 = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");
const newToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

export type GuestLinkRow = {
  id: string;
  label: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
  stepsUsed: number;
  stepsLimit: number | null;
};

// Create a guest account + its link. The account has no password and no real mailbox: the
// address only satisfies the unique-email column and names the account in listings.
export async function createGuestLink(
  opts: { steps?: number; days?: number; label?: string } = {},
): Promise<{ url: string; id: string; expiresAt: Date }> {
  const steps = opts.steps ?? TRIAL_STEPS;
  const days = opts.days ?? TRIAL_DAYS;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const ctx = await auth.$context;

  const created = await ctx.internalAdapter.createUser(
    { email: `guest-${crypto.randomUUID()}@guests.orin.invalid`, name: opts.label?.trim() || "Guest", emailVerified: true },
    { method: "anonymous" },
  );
  // The create hook already inserted a default access row; a guest's differs (tier + expiry
  // tied to the link), so overwrite it.
  await db
    .insert(accountAccess)
    .values({ userId: created.id, tier: "guest", stepsLimit: steps, expiresAt })
    .onConflictDoUpdate({ target: accountAccess.userId, set: { tier: "guest", stepsLimit: steps, expiresAt } });

  const token = newToken();
  const [row] = await db
    .insert(guestLink)
    .values({ tokenHash: sha256(token), userId: created.id, label: opts.label ?? null, expiresAt })
    .returning({ id: guestLink.id });
  return { url: `${WEB_ORIGIN}/g/${token}`, id: row.id, expiresAt };
}

// Use a link: mint a single-use magic-link token for its account and hand back the URL the
// browser should follow. Better Auth sets the session cookie there and redirects home, so
// no session is hand-built here. null = unknown, revoked or expired link.
export async function redeemGuestLink(token: string): Promise<{ verifyUrl: string } | null> {
  const [link] = await db
    .select({ email: user.email })
    .from(guestLink)
    .innerJoin(user, eq(user.id, guestLink.userId))
    .where(and(eq(guestLink.tokenHash, sha256(token)), isNull(guestLink.revokedAt)))
    .limit(1);
  if (!link) return null;

  const [row] = await db
    .select({ expiresAt: guestLink.expiresAt })
    .from(guestLink)
    .where(eq(guestLink.tokenHash, sha256(token)));
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;

  const captureId = crypto.randomUUID();
  try {
    await auth.api.signInMagicLink({
      body: { email: link.email, callbackURL: WEB_ORIGIN, metadata: { captureId } },
      headers: new Headers(), // server-side call: the endpoint requires headers, there's no request
    });
    return magicLinkCapture.get(captureId) ? { verifyUrl: magicLinkCapture.get(captureId)! } : null;
  } finally {
    magicLinkCapture.delete(captureId); // single use, and never left in memory
  }
}

// Stop a link working. The account and its projects stay (data is only removed by prune, 7d).
export async function revokeGuestLink(id: string): Promise<boolean> {
  const revoked = await db
    .update(guestLink)
    .set({ revokedAt: new Date() })
    .where(and(eq(guestLink.id, id), isNull(guestLink.revokedAt)))
    .returning({ id: guestLink.id });
  return revoked.length > 0;
}

// Newest first, with each link's usage — what the CLI prints and (7g) the admin page lists.
export async function listGuestLinks(): Promise<GuestLinkRow[]> {
  return db
    .select({
      id: guestLink.id,
      label: guestLink.label,
      expiresAt: guestLink.expiresAt,
      revokedAt: guestLink.revokedAt,
      stepsUsed: accountAccess.stepsUsed,
      stepsLimit: accountAccess.stepsLimit,
    })
    .from(guestLink)
    .innerJoin(accountAccess, eq(accountAccess.userId, guestLink.userId))
    .orderBy(desc(guestLink.createdAt));
}
