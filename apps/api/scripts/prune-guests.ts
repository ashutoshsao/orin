// Delete expired guest / BYOK accounts, their deployments and R2 bundles. DRY BY DEFAULT:
//   bun run prune-guests                      → what would go
//   bun run prune-guests --older-than 30d
//   bun run prune-guests --yes                → actually delete
// Allowlist accounts are never candidates. Deployed: `kubectl exec -n orin-app deploy/api -- …`.
// Also run by the prune-guests CronJob; importing this CLI never starts the API or E2B sweep.
import { findPruneCandidates, parseAge, prune, PRUNE_RETENTION } from "../src/admin/prune";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

try {
  const olderThan = flag("older-than") ?? PRUNE_RETENTION;
  const olderThanMs = parseAge(olderThan);
  const candidates = await findPruneCandidates(olderThanMs);
  if (candidates.length === 0) {
    console.log(`nothing expired more than ${olderThan} ago`);
    process.exit(0);
  }
  for (const c of candidates) {
    console.log(`${c.email}  ${c.tier}  expired ${c.expiredAt.toLocaleDateString()}  ${c.projects} projects  ${c.deployments} deployments  ${c.objects} bundles (${mb(c.bytes)})`);
  }
  const totalBytes = candidates.reduce((n, c) => n + c.bytes, 0);
  console.log(`\n${candidates.length} accounts, ${mb(totalBytes)} in R2`);

  if (!args.includes("--yes")) {
    console.log("dry run — nothing deleted. Re-run with --yes to delete.");
    process.exit(0);
  }
  const { deleted, skipped, failed } = await prune(candidates, { olderThanMs });
  console.log(`deleted ${deleted.length} accounts (Vercel + R2 + Postgres); skipped ${skipped.length} renewed, protected or already removed accounts`);
  for (const f of failed) console.error(`kept ${f.userId} for retry — cleanup failed: ${f.message}`);
  process.exit(failed.length ? 1 : 0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
