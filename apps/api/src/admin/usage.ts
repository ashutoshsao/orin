import { desc, eq, sql } from "drizzle-orm";
import { accountAccess, db, project, user } from "@repo/db";

// Who has access and what they've spent — the admin page's table (7g). Read-only.
export type UsageRow = {
  userId: string;
  email: string;
  tier: string;
  stepsUsed: number;
  stepsLimit: number | null;
  expiresAt: Date | null;
  projects: number;
  lastActive: Date | null;
};

export async function usageOverview(): Promise<UsageRow[]> {
  return db
    .select({
      userId: accountAccess.userId,
      email: user.email,
      tier: accountAccess.tier,
      stepsUsed: accountAccess.stepsUsed,
      stepsLimit: accountAccess.stepsLimit,
      expiresAt: accountAccess.expiresAt,
      projects: sql<number>`count(${project.id})::int`,
      lastActive: sql<Date | null>`max(${project.updatedAt})`,
    })
    .from(accountAccess)
    .innerJoin(user, eq(user.id, accountAccess.userId))
    .leftJoin(project, eq(project.userId, accountAccess.userId))
    .groupBy(accountAccess.userId, user.email, accountAccess.tier, accountAccess.stepsUsed, accountAccess.stepsLimit, accountAccess.expiresAt)
    .orderBy(desc(sql`max(${project.updatedAt})`));
}

// Admin is an env list, deliberately separate from the allowlist tier: being able to build
// with Orin is not the same as being able to mint access to it.
const admins = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const isAdminEmail = (email: string | undefined | null) => !!email && admins.has(email.toLowerCase());
export const adminCount = admins.size;
