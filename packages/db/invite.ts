import { db, allowlist } from "./src/index";

// Add an email to the invite allowlist:  bun run invite <email>
const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error("usage: bun run invite <email>");
  process.exit(1);
}

await db.insert(allowlist).values({ email }).onConflictDoNothing();
console.log("invited:", email);
process.exit(0);
