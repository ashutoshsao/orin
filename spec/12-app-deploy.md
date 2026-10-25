# 12 — Deploy the apps Orin builds

Promoted from `future-considerations.md` → "Deployment: Vercel Deploy Files + Claim".

## Goal

A user can turn the app they built into a live URL they can share, and later take it into their own
Vercel account. Full-stack apps get a Neon database that travels with the app when it's claimed.

## Decisions (2026-10-23)

- **Deploy is a server action, never an agent tool.** A "Deploy" button; the API reads files out of the
  sandbox and talks to Vercel. No Vercel/Neon token ever enters the sandbox (same rule as BYOK keys).
- **The builder always shows the sandbox preview.** Publish is an explicit release step; later edits
  require Update. The published URL, copy/open controls and Unpublish stay in the preview toolbar,
  independent of chat history. Unpublish removes the Vercel project and its hosted versions while
  keeping code, chat and the sandbox's normal lifecycle. Republishing may require another address.
- **Tier decides the account the app lives in:**

| Tier | Mode | Lifetime |
|---|---|---|
| guest | anonymous (`vercel deploy --temporary`) | **60 min**, claim to keep |
| byok | anonymous + claim prompt | 60 min unless claimed into their own Vercel |
| allowlist | Orin's Vercel team (`POST /v2/files` → `POST /deployments`), claim optional | until deleted / claimed |

- **DB = Neon via the Vercel Marketplace** on Orin's team (`POST /v1/storage/stores/integration/direct`
  → connect to project → `DATABASE_URL` injected). Only path where project + DB transfer together on
  claim and keep working. Sandbox gets a Neon **dev branch** of the same DB.
- Rejected for deployed apps: Neon claimable Postgres (72 h, 100 MB, claim rotates the password → breaks
  the live app); Neon transfer requests (private preview); Neon Agent Plan (needs Scale).
- **Close the session when the turn ends, not when the viewer leaves**: the grace timer starts after the
  turn finishes or parks on `ask_user`, not while it's running (step budget already caps cost).

## Verified (probe, 2026-10-23)

- `vercel deploy --temporary` with an empty `--global-config`: `Not authenticated. Deploying
  anonymously.` → builds **locally**, returns JSON `{ url: *.tmp.now, expiresAt, claimUrl }`,
  **expires in 60 minutes**. Redeploying the same dir reuses the same anonymous deployment.
- With a stored login it silently ignores `--temporary` and deploys to that account — must always pass an
  empty `--global-config` and unset `VERCEL_TOKEN`.
- **Real deploy via `deployProject` (2026-10-23):** template source, 16 files → READY in 39 s first time,
  14 s on redeploy (same project, same URL). Public URL = shortest alias `orin-<id>.vercel.app`; the
  per-deployment and `-<team>` URLs 302 to Vercel login (deployment protection). The alias 404s
  (`DEPLOYMENT_NOT_FOUND`) for a few seconds after READY → `waitServing` before `deploy_ready`.
- Local probing succeeded with a token and no explicit `teamId`. Production now also loads
  `VERCEL_TOKEN` from the encrypted Kubernetes Secret. `VERCEL_TEAM_ID` selects an explicit hosting
  team when set; a token's access scope and the request's selected team are separate settings.
- **Template bug:** `apps/react-template` fails `tsc -b` (`main.tsx` imports `./App.tsx`, TS5097). The
  agent was fixing it with `sed` on every project.

## Open

- Template for full-stack: **Next.js** (dev = prod; v0's choice) vs Vite + `api/` Vercel Functions (no
  local runner for functions in the sandbox). Leaning Next.js.
- Does Hobby allow `transfer-request` + Marketplace stores via API, or is Pro needed?
- Neon free-plan cap on Marketplace-provisioned DBs; exact store→project connect endpoint.
- 60-min anonymous is a demo link, not hosting — guests may need a team deploy with prune, or no deploy.
- Vercel cleanup is implemented in spec 13; Neon store cleanup remains required before provisioning
  databases, along with ownership tracking for claimed/transferred resources.

## Progress

- [x] Fix template `main.tsx` import (8633dd8) — rebuild `e2b:build:dev`: the API uses the `-dev` template (agent.ts TEMPLATE), not prod
- [x] Session lifetime: grace timer starts at turn end / ask_user, not viewer leave — test fails on old code
- [x] A — allowlist publishing: source export, Vercel build, explicit link-name dialog, persistent
  toolbar URL, copy/open, Update and confirmed Unpublish are implemented. Production API 1.0.4
  has the publishing token configured; see the verification evidence below.
- [x] Release audit fixes in API 1.0.5: deployed and verified at commit `d532545`. Show a disabled Publish control
  with an explanation when hosting is unconfigured, recover from network failures, restore publishing
  state when reopening, allow Unpublish without a running sandbox, and reject HTTP error pages in
  readiness checks. Commit/tag and cluster rollout were performed manually.
  Validation on 2026-10-25: 54 API tests and 29 web tests passed, including database name reservation,
  deployment ownership checks, reconnect state and the unavailable-publishing UI. API typecheck,
  web build/lint and a client-side Kubernetes manifest dry run passed.
- [x] Verify production Update preserves the URL: the user confirmed Publish → edit → Update works.
  The separate log review below covers initial publish/unpublish; the Update check is user-reported.
- [ ] A' — anonymous deploy (guest/byok) with expiry + claim link in the UI
- [ ] B — claim: `POST /projects/:id/transfer-request` → claim URL
- [ ] C — full-stack template + Marketplace Neon + dev branch in sandbox
- [x] Prune deletes verified Orin Vercel projects before files and database rows (spec 13;
  prepared for API 1.0.6 and its daily CronJob, not yet deployed).
- [ ] Prune deletes Orin-owned Neon resources once database provisioning is implemented.

## Production verification (reviewed 2026-10-25)

- API health reports version `1.0.4`; its running pod uses `deepseek-flash` and has `VERCEL_TOKEN`
  present. The production web bundle includes the Publish controls.
- API logs on 2026-10-23 UTC record `deploy_started` at 22:23:33, `deploy_ready` at 22:23:50
  for `https://verdant-spice-co-212b.vercel.app`, and `deploy_unpublished` at 22:25:00.
  The removed URL returned HTTP 404 when checked on 2026-10-25.
- The same session's sandbox closed later, at 22:26:18; Unpublish does not call sandbox teardown.
  These logs confirm the backend operations, not a fresh browser interaction or a production Update.
- Browser re-verification was unavailable: the collaborative browser snapshot timed out twice.
