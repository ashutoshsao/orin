import { migrate } from "drizzle-orm/bun-sql/migrator";
import { db } from "./src/index";

// Apply generated migrations using Bun's SQL driver (drizzle-kit's own `migrate`
// wants a Node driver like pg/postgres — which apps/api/CLAUDE.md forbids — so we
// run the migrator ourselves through the Bun-SQL client instead).
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("migrations applied ✓");
process.exit(0);
