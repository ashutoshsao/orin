import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

// Generate-only config for the Better Auth CLI. It mirrors auth.ts's
// schema-affecting options but does NOT import the Bun-SQL db — the CLI runs under
// Node/jiti, which can't load drizzle-orm/bun-sql. Runtime uses ./auth.ts (Bun).
export const auth = betterAuth({
  database: drizzleAdapter({} as never, { provider: "pg" }),
  emailAndPassword: { enabled: true },
});
