import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { accountAccess, db, guestLink, user } from "@repo/db";
import { TRIAL_DAYS, TRIAL_STEPS } from "../persistence/access";

// Only the account owner can request; authentication is checked by the route even
// after access expires. Repeated clicks preserve the original request time.
export async function requestTrialExtension(userId: string): Promise<Date | null> {
  const [row] = await db.update(accountAccess)
    .set({ extensionRequestedAt: sql`coalesce(${accountAccess.extensionRequestedAt}, now())` })
    .where(and(
      eq(accountAccess.userId, userId),
      inArray(accountAccess.tier, ["guest", "byok"]),
      isNotNull(accountAccess.stepsLimit),
      or(lte(accountAccess.expiresAt, sql`now()`), sql`${accountAccess.stepsUsed} >= ${accountAccess.stepsLimit}`),
    ))
    .returning({ requestedAt: accountAccess.extensionRequestedAt });
  return row?.requestedAt ?? null;
}

// Admin-only at the route. Keep lifetime usage and add budget rather than resetting
// stepsUsed; an expired GitHub account continues under the same sign-in identity.
export async function extendTrial(userId: string): Promise<{ expiresAt: Date; stepsLimit: number } | null> {
  return db.transaction(async tx => {
    // Same lock order as cleanup. If cleanup has already finished, the identity
    // still exists and can be renewed; already removed project data stays removed.
    const [owner] = await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    if (!owner) return null;
    const [access] = await tx.select().from(accountAccess).where(eq(accountAccess.userId, userId)).for("update");
    if (!access || access.stepsLimit === null || !["guest", "byok"].includes(access.tier)) return null;
    const expiresAt = new Date(Math.max(Date.now(), access.expiresAt?.getTime() ?? 0) + TRIAL_DAYS * 86_400_000);
    const stepsLimit = access.stepsLimit + TRIAL_STEPS;
    await tx.update(accountAccess).set({ expiresAt, stepsLimit, extensionRequestedAt: null }).where(eq(accountAccess.userId, userId));
    // Renew existing unrevoked guest links as well, so the same magic link works.
    await tx.update(guestLink).set({ expiresAt }).where(and(eq(guestLink.userId, userId), isNull(guestLink.revokedAt)));
    return { expiresAt, stepsLimit };
  });
}
