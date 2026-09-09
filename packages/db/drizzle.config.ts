import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // both our app tables and the Better Auth-generated tables (not ./src/index.ts —
  // that imports the bun-sql client, which drizzle-kit's Node loader can't read)
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle", // generated SQL migrations live here
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
