import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db, allowlist } from "@repo/db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
  // web (Vite) origin — needed for cross-origin auth requests
  trustedOrigins: ["http://localhost:5173"],
  databaseHooks: {
    user: {
      create: {
        // Invite gate: reject signup unless the email is on the allowlist.
        before: async (user) => {
          const [row] = await db
            .select()
            .from(allowlist)
            .where(eq(allowlist.email, user.email.toLowerCase()))
            .limit(1);
          if (!row) {
            throw new APIError("FORBIDDEN", {
              message: "This email isn't on the invite list yet.",
            });
          }
        },
      },
    },
  },
});
