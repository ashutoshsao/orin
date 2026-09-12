// Delete expired guest / BYOK accounts and their R2 bundles (7d). DRY BY DEFAULT:
//   bun run prune-guests                      → what would go
//   bun run prune-guests --older-than 30d
//   bun run prune-guests --yes                → actually delete
// Allowlist accounts are never candidates. Deployed: `kubectl exec deploy/orin-api -- …`.
import { findPruneCandidates, parseAge, prune } from "../src/admin/prune";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

try {
  const olderThan = flag("older-than") ?? "7d";
  const candidates = await findPruneCandidates(parseAge(olderThan));
  if (candidates.length === 0) {
    console.log(`nothing expired more than ${olderThan} ago`);
    process.exit(0);
  }
  for (const c of candidates) {
    console.log(`${c.email}  ${c.tier}  expired ${c.expiredAt.toLocaleDateString()}  ${c.projects} projects  ${c.objects} bundles (${mb(c.bytes)})`);
  }
  const totalBytes = candidates.reduce((n, c) => n + c.bytes, 0);
  console.log(`\n${candidates.length} accounts, ${mb(totalBytes)} in R2`);

  if (!args.includes("--yes")) {
    console.log("dry run — nothing deleted. Re-run with --yes to delete.");
    process.exit(0);
  }
  const { deleted, failed } = await prune(candidates);
  console.log(`deleted ${deleted.length} accounts (R2 + Postgres)`);
  for (const f of failed) console.error(`kept ${f.userId} — R2 delete failed: ${f.message}`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
