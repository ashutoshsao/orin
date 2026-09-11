// Print a one-time link for an email account (7b):
//   bun run invite <email>            → first password (also allowlists the address)
//   bun run invite <email> --reset    → replace a forgotten password
// Deployed: `kubectl exec deploy/orin-api -- bun run invite <email>`.
import { createInviteLink } from "../src/admin/invites";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const kind = args.includes("--reset") ? "reset" : "invite";
if (!email) {
  console.error("usage: bun run invite <email> [--reset]");
  process.exit(1);
}
try {
  const { url, expiresAt } = await createInviteLink(email, kind);
  console.log(`${kind} link for ${email} (expires ${expiresAt.toLocaleString()}):\n${url}`);
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e)); // a plain line, not a stack
  process.exit(1);
}
