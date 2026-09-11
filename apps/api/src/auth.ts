import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
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

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  // Email accounts are created only through one-time invite links (admin/invites.ts) —
  // knowing an allowlisted address isn't enough to claim it. Sign-in stays open.
  emailAndPassword: { enabled: true, disableSignUp: true },
  socialProviders: github ? { github } : {},
  // web (Vite) origin — needed for cross-origin auth requests and the OAuth callbackURL
  trustedOrigins: [WEB_ORIGIN],
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
