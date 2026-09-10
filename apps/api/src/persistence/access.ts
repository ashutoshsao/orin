import { accountAccess, db } from "@repo/db";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

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
export type AccessCheck = { ok: true } | { ok: false; reason: "expired" | "no_access" };

export async function checkAccess(userId: string): Promise<AccessCheck> {
  const [row] = await db
    .select({ expiresAt: accountAccess.expiresAt })
    .from(accountAccess)
    .where(eq(accountAccess.userId, userId));
  if (!row) return { ok: false, reason: "no_access" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };
  return { ok: true };
}

// Seam handed to AgentSession: the loop only sees reserve/refund, never the DB.
export function stepBudget(userId: string) {
  return { reserve: () => reserveStep(userId), refund: () => refundStep(userId) };
}
