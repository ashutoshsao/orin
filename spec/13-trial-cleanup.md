# 13 — Scheduled cleanup of expired trial data

## Goal

Bound public-trial and invited-guest storage costs without leaving untracked hosted apps behind.
Access still expires after its configured trial period; saved data is retained for another seven
days, then a daily Kubernetes Job removes expired guest/BYOK accounts and their tracked resources.

## Contract

- Only expired `guest` or `byok` accounts with a step limit are eligible. Unlimited accounts,
  allowlisted emails, the `allowlist` tier, renewed trials and missing accounts are excluded.
- `prune-guests` defaults to a read-only preview; `--yes` is required for deletion. Preview output
  includes hosted-project counts, project counts, saved-bundle counts and bytes.
- Re-check eligibility under user/access row locks immediately before deleting resources.
  Concurrent cleanup invocations serialize per account; new project inserts are blocked during
  deletion. Database references survive failures for a later retry.
- Delete verified Orin Vercel projects first, then that user's `guests/<userId>/` and `users/<userId>/`
  R2 objects across every listing page (including legacy bundles from a downgraded account), then
  the user row (cascading projects, chats, snapshots, auth sessions and guest links).
  Missing remote projects are already cleaned. Provider authorization/ownership failures keep the
  account and files. With no hosted projects, missing Vercel credentials do not block file cleanup.
- This is a sequence of retryable deletions, not a distributed transaction. An external deletion
  cannot be undone when a later operation fails. Backup archives follow their own retention.
- Run the standalone CLI at 04:00 UTC daily (09:30 India time), with a seven-day post-expiry grace
  period, no overlapping scheduled runs, two Job retries and a 20-minute total deadline. Never
  start another API server from the Job: its startup sweep would kill unrelated live sandboxes.
- Sandbox files disappear with the VM's existing grace/timeout lifecycle; this job deletes durable
  files and records. It does not enumerate and kill other E2B sandboxes.
- Inform expired users that trial apps and data are scheduled for deletion seven days after expiry.

## Limits and future resource types

Guest/BYOK publishing is still disabled. The Vercel cleanup handles tracked deployments on any
eligible account (including an account downgraded after publishing). Neon resources are not yet
provisioned or tracked, so this release does not claim to delete databases. Before enabling Neon,
store resource IDs and ownership, remove only Orin-owned resources on cleanup, and preserve any
resources transferred to users. Anonymous temporary deployment cleanup belongs with that feature.

## Progress

- [x] Shared prune implementation with eligibility revalidation and Vercel → R2 → Postgres cleanup.
- [x] Manual preview, deployment counts, explicit `--yes`, and per-account retry/skip reporting.
- [x] Kubernetes CronJob manifest and ops release notes prepared for image 1.0.6.
- [x] Expired-access screen states the retention policy.
- [x] Validation: 18 cleanup/ownership tests passed, including real local Postgres + throwaway
  R2 objects, protected accounts, pagination, partial failures, retries and overlapping runs.
  API typecheck, web build/lint, a read-only CLI preview and Kubernetes server dry runs passed.
- [ ] Manual release: commit/tag API 1.0.6, deploy it, preview production candidates, then apply
  `~/projects/ops/orin-app-k8s/09-trialCleanupCronjob.yml` to enable scheduled deletion.
