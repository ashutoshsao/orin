import { accountAccess, allowlist, db } from "@repo/db";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

// Limited-tier trial (7): 60 steps, access for 7 days. Bounds LLM spend, sandbox time and R2 —
// BYOK visitors pay their own tokens but still use our sandboxes and storage.
//
// 60 is three full runs at `maxIteration` 20 — that's the unit the number means, and it's why it
// isn't topped up for repairs. A repair (the agent handed its own crashed dev server or a module
// that won't compile) spends a step like any other LLM call: the budget is reserved in one atomic
// UPDATE, and carving out an exception inside that statement is how the two-tabs race gets back
// in. Two repairs out of 60 is noise against a run that costs 20, and repairs are capped per
// incident (agent/config.ts) precisely so they can't add up to anything that matters.
export const TRIAL_STEPS = 60;
export const TRIAL_DAYS = 7;

export const trialExpiry = (from = Date.now()) => new Date(from + TRIAL_DAYS * 24 * 60 * 60 * 1000);

// The access row a brand-new account starts with: allowlisted email → unlimited, forever;
// anyone else (a GitHub sign-in) → the BYOK trial.
export async function accessForNewUser(email: string) {
  const [listed] = await db.select().from(allowlist).where(eq(allowlist.email, email.toLowerCase())).limit(1);
  if (listed) return { tier: "allowlist" as const, stepsLimit: null, expiresAt: null };
  return { tier: "byok" as const, stepsLimit: TRIAL_STEPS, expiresAt: trialExpiry() };
}

// Why a step was refused: out of budget, access expired, or no access row at all (fail
// closed — every account gets one at sign-up and existing ones were backfilled).
export type StepDenied = "steps" | "expired" | "no_access";
export type StepReservation = { ok: true } | { ok: false; reason: StepDenied };

// Reserve one step (one LLM call) for a user, BEFORE the call (7a). A single conditional
// UPDATE, so two tabs racing for the last step can't both win: Postgres serialises the row,
// and the second re-checks `steps_used < steps_limit` against the first's committed value.
// Unlimited accounts still count (`steps_used` doubles as usage). Expiry rides the same
// statement, so an open session stops at its next call once access lapses.
export async function reserveStep(userId: string): Promise<StepReservation> {
  const reserved = await db
    .update(accountAccess)
    .set({ stepsUsed: sql`${accountAccess.stepsUsed} + 1` })
    .where(and(
      eq(accountAccess.userId, userId),
      or(isNull(accountAccess.stepsLimit), lt(accountAccess.stepsUsed, accountAccess.stepsLimit)),
      or(isNull(accountAccess.expiresAt), gt(accountAccess.expiresAt, sql`now()`)),
    ))
    .returning({ userId: accountAccess.userId });
  if (reserved.length > 0) return { ok: true };

  // Refused — look once more only to say why (the note differs); no write, so no race.
  const access = await checkAccess(userId);
  return { ok: false, reason: access.ok ? "steps" : access.reason };
}

// Give a reserved step back when the LLM call didn't produce a usable response (provider
// error/exception) — the user shouldn't pay a step for our failure. Never goes below zero.
export async function refundStep(userId: string): Promise<void> {
  await db
    .update(accountAccess)
    .set({ stepsUsed: sql`${accountAccess.stepsUsed} - 1` })
    .where(and(eq(accountAccess.userId, userId), gt(accountAccess.stepsUsed, 0)));
}

// Whether a signed-in user may use the API at all (7a) — checked on every request. Access
// expiry is automatic; data is untouched (deleted only by prune, 7d). No row = no access
// (fail closed; every account gets one at sign-up).
// `limited` = the account has a step limit (guest / byok): one live session at a time.
export type AccessCheck = { ok: true; limited: boolean } | { ok: false; reason: "expired" | "no_access" };

export async function checkAccess(userId: string): Promise<AccessCheck> {
  const [row] = await db
    .select({ expiresAt: accountAccess.expiresAt, stepsLimit: accountAccess.stepsLimit })
    .from(accountAccess)
    .where(eq(accountAccess.userId, userId));
  if (!row) return { ok: false, reason: "no_access" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, limited: row.stepsLimit !== null };
}

// What the UI shows about an account's access (GET /me): tier, steps left, expiry. Read
// even when expired — that's how the page knows to show "access ended" instead of an
// empty home. null = no access row.
export type AccessView = {
  tier: string;
  stepsLimit: number | null;
  stepsUsed: number;
  stepsLeft: number | null; // null = unlimited
  expiresAt: string | null;
  expired: boolean;
};

export async function getAccessView(userId: string): Promise<AccessView | null> {
  const [row] = await db.select().from(accountAccess).where(eq(accountAccess.userId, userId));
  if (!row) return null;
  return {
    tier: row.tier,
    stepsLimit: row.stepsLimit,
    stepsUsed: row.stepsUsed,
    stepsLeft: row.stepsLimit === null ? null : Math.max(0, row.stepsLimit - row.stepsUsed),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: !!row.expiresAt && row.expiresAt.getTime() <= Date.now(),
  };
}

// Seam handed to AgentSession: the loop only sees reserve/refund, never the DB.
export function stepBudget(userId: string) {
  return { reserve: () => reserveStep(userId), refund: () => refundStep(userId) };
}
