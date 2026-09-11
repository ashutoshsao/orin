import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { db, accountAccess } from "@repo/db";
import { accessForNewUser } from "./persistence/access";

export const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

// GitHub sign-in is on only when its OAuth app is configured (7b), so local dev without
// credentials still boots — the web asks GET /config whether to show the button.
const github =
  process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ? { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET }
    : null;
export const githubEnabled = github !== null;

// Guest links (7c) sign into an existing guest account with no password. Instead of
// hand-rolling a session, we mint a single-use magic-link token server-side per visit: the
// callback hands the URL back through `magicLinkCapture` (keyed by a metadata id) rather
// than emailing it, and Better Auth itself sets the cookie when the browser follows it.
export const magicLinkCapture = new Map<string, string>();

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  // Email accounts are created only through one-time invite links (admin/invites.ts) —
  // knowing an allowlisted address isn't enough to claim it. Sign-in stays open.
  emailAndPassword: { enabled: true, disableSignUp: true },
  socialProviders: github ? { github } : {},
  // web (Vite) origin — needed for cross-origin auth requests and the OAuth callbackURL
  trustedOrigins: [WEB_ORIGIN],
  plugins: [
    magicLink({
      // Never creates accounts: a magic link is only ever minted for a guest account that
      // `guest-link` already made. An unknown email is simply refused.
      disableSignUp: true,
      expiresIn: 120, // seconds — the browser follows it immediately
      sendMagicLink: async ({ url, metadata }) => {
        const captureId = metadata?.captureId;
        if (typeof captureId === "string") magicLinkCapture.set(captureId, url);
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        // Every account gets an access row (7a). The tier comes from the allowlist, never
        // from the sign-in method: allowlisted → unlimited; anyone else (GitHub) → a limited
        // trial. Guest links (7c) overwrite this row for their accounts.
        after: async (user) => {
          await db
            .insert(accountAccess)
            .values({ userId: user.id, ...(await accessForNewUser(user.email)) })
            .onConflictDoNothing();
        },
      },
    },
  },
});
