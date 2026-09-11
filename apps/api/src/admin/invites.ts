import { and, eq, gt, isNull } from "drizzle-orm";
import { allowlist, db, invite, user } from "@repo/db";
import { auth, WEB_ORIGIN } from "../auth";

// One-time email links (7b). Shared by the CLI and (7g) the admin page — no logic lives in
// either entry point. The raw token exists only in the printed URL; the DB holds its hash.

export type InviteKind = "invite" | "reset";
const LINK_HOURS = 48;

const sha256 = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

// Create a link. `invite` also puts the email on the allowlist (that's what makes the new
// account unlimited); `reset` requires the account to exist. Older unused links of the same
// kind for that email are burned, so only the newest one works.
export async function createInviteLink(rawEmail: string, kind: InviteKind = "invite"): Promise<{ url: string; expiresAt: Date }> {
  const email = rawEmail.trim().toLowerCase();
  if (!email.includes("@")) throw new Error(`not an email: ${rawEmail}`);
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (kind === "invite" && existing) throw new Error(`${email} already has an account — use a reset link`);
  if (kind === "reset" && !existing) throw new Error(`${email} has no account — use an invite link`);

  if (kind === "invite") await db.insert(allowlist).values({ email }).onConflictDoNothing();
  await db
    .update(invite)
    .set({ usedAt: new Date() })
    .where(and(eq(invite.email, email), eq(invite.kind, kind), isNull(invite.usedAt)));

  const token = newToken();
  const expiresAt = new Date(Date.now() + LINK_HOURS * 60 * 60 * 1000);
  await db.insert(invite).values({ tokenHash: sha256(token), email, kind, expiresAt });
  return { url: `${WEB_ORIGIN}/invite/${token}`, expiresAt };
}

// What the invite page shows before the password is chosen. null = unknown, used or expired
// (deliberately indistinguishable to whoever holds the link).
export async function peekInvite(token: string): Promise<{ email: string; kind: InviteKind } | null> {
  const [row] = await db
    .select({ email: invite.email, kind: invite.kind })
    .from(invite)
    .where(and(eq(invite.tokenHash, sha256(token)), isNull(invite.usedAt), gt(invite.expiresAt, new Date())));
  return row ?? null;
}

export class InviteError extends Error {}

// Use a link: claim it atomically (one UPDATE … WHERE used_at IS NULL — two clicks can't both
// win), then create the account or replace the password. If that work fails the claim is
// released, so a transient error doesn't burn someone's link.
export async function acceptInvite(token: string, password: string): Promise<{ email: string; kind: InviteKind }> {
  const ctx = await auth.$context;
  const { minPasswordLength, maxPasswordLength } = ctx.password.config;
  if (password.length < minPasswordLength) throw new InviteError(`Password must be at least ${minPasswordLength} characters.`);
  if (password.length > maxPasswordLength) throw new InviteError("That password is too long.");

  const tokenHash = sha256(token);
  const [claimed] = await db
    .update(invite)
    .set({ usedAt: new Date() })
    .where(and(eq(invite.tokenHash, tokenHash), isNull(invite.usedAt), gt(invite.expiresAt, new Date())))
    .returning({ email: invite.email, kind: invite.kind });
  if (!claimed) throw new InviteError("This link has expired or was already used.");

  try {
    const hash = await ctx.password.hash(password);
    const existing = await ctx.internalAdapter.findUserByEmail(claimed.email);
    if (claimed.kind === "invite") {
      if (existing) throw new InviteError("This account is already set up — sign in instead.");
      // Runs the user.create hooks, so the access row (allowlist tier) is created as usual.
      const created = await ctx.internalAdapter.createUser(
        { email: claimed.email, name: claimed.email.split("@")[0], emailVerified: true },
        { method: "email-password" }, // provisioning source; runs the user.create hooks → access row
      );
      await ctx.internalAdapter.linkAccount({ userId: created.id, providerId: "credential", accountId: created.id, password: hash });
    } else {
      if (!existing) throw new InviteError("There's no account for this link.");
      const userId = existing.user.id;
      if (await ctx.internalAdapter.findCredentialAccount(userId)) await ctx.internalAdapter.updatePassword(userId, hash);
      else await ctx.internalAdapter.linkAccount({ userId, providerId: "credential", accountId: userId, password: hash });
      await ctx.internalAdapter.deleteUserSessions(userId); // a reset signs out everywhere else
    }
    return claimed;
  } catch (e) {
    if (!(e instanceof InviteError)) await db.update(invite).set({ usedAt: null }).where(eq(invite.tokenHash, tokenHash));
    throw e;
  }
}
