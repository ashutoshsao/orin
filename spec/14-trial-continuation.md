# 14 — Keep trial identities and provide a continuation path

## Goal

Keep a lightweight record of everyone who tried Orin while bounding the cost of their project
files and deployments. Make trial terms visible and let returning users request more access
without creating another account or silently receiving another trial budget.

## Contract

- Trial cleanup removes Vercel projects, R2 bundles and project/chat/snapshot rows. Retain the user,
  linked GitHub/credential identity, guest link, access tier, expiry and lifetime usage.
- Migration 0012 adds `account_access.data_purged_at` and `extension_requested_at`.
  A completed cleanup marks the current trial cycle. Later cleanup skips it until an extended
  trial has expired; an extension never restores project data that was already deleted.
- The sign-in screen discloses the default 60-step, seven-day BYOK trial. Home and builder show
  actual remaining steps, expiry and the seven-day post-expiry project cleanup date.
- When the budget is exhausted or access has expired, **Request more access** creates a pending
  request for the authenticated account. Requests are idempotent; they do not grant steps, extend
  access or postpone cleanup. Adding a different API key does not reset an infrastructure budget.
- `/admin` shows pending requests first. **Extend trial** is admin-only and adds 60 steps to the
  existing limit plus seven days to the later of the current expiry or now. Never reset steps used.
  Renew unrevoked guest links for the same account, clear the request, and retain the cleanup record.
- Requests send no external message/email. After the owner approves, the user can click
  **Refresh access** on the expired screen (or reload home when out of steps).
- A renewed account returns home if its previously open project was already cleaned.

## Progress

- [x] Account-retaining cleanup with a marker for each completed trial cycle.
- [x] Signed-in request endpoint and admin-only extension endpoint, isolated from server startup.
- [x] Pre-sign-in disclosure, in-app deadlines, request status and admin extension controls.
- [x] Database migration generated and applied to local Postgres only.
- [x] Validation: 35 API tests and 7 UI tests passed, covering retained sign-in identity and usage,
  project/chat/snapshot deletion, repeat cleanup, renewal, guest-link expiry, authenticated request
  ownership and admin-only approval. API typecheck, web build/lint and Kubernetes server dry runs passed.
- [ ] Manual release of API 1.0.7 and migration 0012, web deployment, then enable the updated CronJob.
  The cluster was checked during implementation: no `prune-guests` CronJob was installed.

## Manual release order

1. Commit these Orin changes and push `main`; tag and push `v1.0.7`.
2. Wait for the API image build, then commit/push the ops README and image updates in
   `05-migrate.yml`, `06-api.yml` and `09-trialCleanupCronjob.yml`.
3. Recreate the migration Job from `05-migrate.yml` and wait for migration 0012 to finish.
4. Apply the API Deployment from `06-api.yml` and wait for rollout; confirm health reports 1.0.7.
5. Preview cleanup with `kubectl exec -n orin-app deploy/api -- bun run prune-guests --older-than 7d`.
6. Apply `09-trialCleanupCronjob.yml` to enable scheduled project cleanup with retained accounts.
