# 7 — Access tiers (allowlist · guest links · BYOK visitors)

## Goal

Let people outside the allowlist try Orin — recruiters via a link you send, anyone else via your
portfolio with their own API key — without unbounded LLM spend, sandbox time or R2 storage. Their
access expires after 7 days; trial data becomes eligible for scheduled cleanup seven days after expiry
(spec 13; scheduled cleanup requires its release and CronJob deployment).

## Contract

| | Allowlist (you, Devyanshi) | Guest link (recruiters) | BYOK visitor (portfolio) |
|---|---|---|---|
| Gets in via | GitHub, or email + password | opening the link (no screen) | GitHub |
| LLM key | server's | server's | their own, **session memory only** |
| Steps | unlimited | 60 per account | 60 per account |
| Sandboxes | unlimited | 1 at a time | 1 at a time |
| R2 | last 2 bundles/project | last 2, under `guests/` | last 2, under `guests/` |
| Access | forever | **expires after 7 days** | **expires after 7 days** |
| Data | kept | cleanup seven days after expiry | cleanup seven days after expiry |

- **Tier comes from the allowlist, not the sign-in method**: GitHub email on the allowlist → unlimited.
- The 60-step cap bounds R2 + sandbox time, not only tokens (BYOK pays tokens, not our storage).
- Budget checked **before each LLM call**; at zero → saved "trial used up" note (step-limit machinery).
- BYOK key: never in Postgres, logs, SSE events, snapshots — **never inside the sandbox**.

## Plan

### 7.0 Infra
- [x] Root `bun run dev` = `docker compose up -d --wait` + turbo api & web (api `dev` was the broken Apollo `index.ts`).
- [x] `docker-compose.yml` (postgres:17 named volume + healthcheck; redis:8-alpine, no volume).
- [x] Backup `.backup/orin-20260915-1528.sql` (1.0 MB).
- [x] Backup `.backup/orin-20260917-0146.sql` (fresh, pre-cutover).
- [x] Cutover → restore → verified 1 user / 10 projects / 448 messages / 77 snapshots / 6 migrations.
- [x] Secrets in `.env.docker` via `env_file:` (no flag), `.env.docker.example`, perps-style `.env.*` gitignore.
- [x] Removed old `orin-pg` / `orin-redis` containers + anonymous volumes.
- [x] Verified a real session; deleted `.backup/`.

### 7.1 Snapshot storage hardening (all tiers — do first)
- [x] **Size cap before read-out** (25 MB; real bundles are 45–80 KB): over → skip snapshot, tell the
      agent. A multi-GB repo must never enter API memory (today: `files.read` loads it whole → OOM
      for everyone).
      - Measure in the sandbox: `git bundle create` → `stat -c %s`; read only if ≤ cap; `rm` the bundle
        either way (today every round's bundle is left in `/tmp`).
      - Skipped round sends a `mark` with the unpushed hash → worker won't advance `durableCodebaseN`
        → resume clamps to the last saved round. No worker change.
      - Agent told by appending an `[orin]` note to the round's last tool result **before `flush()`**
        (persisted, protocol-safe; not a fake user message). Plus a `snapshot_skipped` event.
      - Extract bundle step to `agent/snapshot.ts` (sandbox passed in) → unit-testable with a fake.
      - Done: `snapshotRound` + `snapshot.test.ts` (7 pass, fake sandbox); live E2B check — 44 KB bundle
        read, 2 MB over a 1 MB cap skipped unread, `/tmp` left empty. Feed shows "not saved".
- [x] **Rewind by commit, not by bundle** (before pruning — today rewind points at an old bundle file):
      - Invariant: every kept `snapshot` row's commit is an ancestor of the newest bundle's HEAD.
      - Rewind no longer touches `latestSnapshotKey` (stays = newest bundle); only trims messages + rows.
      - Restore: newest bundle → `git fetch` → `reset --hard <commitHash of max-n snapshot row>`.
      - Race: a push queued before rewind must not land after it → worker drops jobs past the rewind.
      - Done: `project.rewind_gen` (0006); jobs carry gen; worker checks it before upload and in the
        push transaction (row lock vs `rewindProject`). Rewind extracted to `store.rewindProject`.
- [x] **Keep last 2 bundles per project**: in the worker, **after** upload + DB update succeed → list the
      project's R2 prefix, delete all but the 2 newest (failed upload deletes nothing; also sweeps rewind leftovers).
      - Done: `retention.bundlesToDelete` (latest key always kept) + tests. Existing projects prune on next push.
      - Live (PG + R2 + E2B): 3 pushes → 2 objects; rewind to v1 → fresh sandbox restores v1 from the v3
        bundle; stale gen-0 push dropped, no row/object. Not exercised: stale job losing at the transaction.
- [ ] ~~Key layout by tier~~ → moved to 7a (needs the tier).
- [x] Tests: oversize repo skipped without loading; old bundles pruned; rewind to any retained step.

### 7a Access model + budget
- [x] `account_access(userId pk → user cascade, tier, stepsLimit null=unlimited, stepsUsed,
      expiresAt, createdAt)`; backfill existing users as `allowlist`.
      - Done: migration 0007 (+ backfill SQL, 1 user); CHECK `steps_used <= steps_limit`; Better Auth
        `user.create.after` inserts an `allowlist` row. Live: sign-up → row, CHECK blocks overspend, user delete cascades.
- [x] **Step = one successful LLM call** (matches the UI's round count). Reserve **before** the call:
      `UPDATE … SET steps_used = steps_used + 1 WHERE steps_limit IS NULL OR steps_used < steps_limit
      RETURNING` — atomic, two tabs can't both spend the last step. Call fails → give the step back.
      - Done: `persistence/access.ts` (reserve/refund) → `StepBudget` seam in the loop; budget store
        error = fail closed (`budget_error`, no LLM call). Expiry rides the same UPDATE (loop half of expiry).
- [x] At zero → saved "trial used up" note (same machinery as the 20-step note) + composer disabled.
      - Done (note half): `BUDGET_NOTES` per reason, `budget_exhausted` event; web renders it like the
        limit card without Continue, status "stopped · trial ended". Composer disabling → UI item.
- [x] **Expiry**: `getUserId()` rejects expired accounts on every request; SSE checked at stream start
      and before each LLM call (an open stream doesn't outlive expiry).
      - Done: `authorize()` replaces `getUserId` on every route — 401 not signed in, 403 `access_expired` /
        `no_access`; stream yields the same as an event. Before each LLM call via `reserveStep` (step 2).
      - **Fixed gap**: `/agent/:sessionId/{message,answer}` had no auth (session id travels in every event/log)
        → now authorize + project ownership (404 otherwise). Live HTTP check: 10/10.
- [x] **1 live session per limited account**: opening another project **closes the first automatically**
      (recruiters shouldn't get an error to decode).
      - Done: `closeOtherLives(userId, keep)` before attach/start (no await between → racing tabs keep one).
        `closeLive` now sends `session_closed {reason}` + ends viewers' streams; web stops (no auto-reconnect —
        two tabs would close each other forever) and offers Reopen. `limited` = `steps_limit` not null.
      - Fixed: live `RUN_ENDS` lacked `budget_exhausted`/`budget_error` → reattach showed "building".
      - Live (stubs, no sandboxes): guest B closes A + A told why; allowlist keeps both.
- [x] R2 key layout by tier: `users/<id>/…` (allowlist) vs `guests/<id>/…` (limited) — moved from 7.1.
      - Scope passed to the enqueuer from `who.limited`; prune reads the prefix off the key.
- [x] UI: "N steps left"; notice + disabled composer at zero.
      - Done: `GET /me` (works while expired) → `useAccess`; home + builder show "Trial · N steps left", disable
        composer at 0; expired / no row → `AccessEndedScreen`. Access re-read on llm_call / budget / expiry events.
        Screenshots checked (3 left, used up home + builder, expired).
- [x] Tests: reserve/refund per step, stop at limit, concurrent last step (one wins), unlimited never
      stops, expired rejected, second project closes the first.
      - Done so far: `access.test.ts` (8, local PG: limit, unlimited, expired, no row, 10-way race → 1 wins,
        refund, floor 0). Live loop (E2B, fake LLM): budget 2 → 2 calls + note; error refunds; store down → no call.

### 7b Auth screen
- [x] Better Auth **GitHub** provider: allowlisted email → `allowlist` tier; otherwise → `byok` tier.
      - Live (real OAuth app): GitHub linked to the existing email account — 1 user, methods
        `credential`+`github`, 10 projects intact, tier `allowlist` unlimited. Tier comes from the
        allowlist, not the sign-in method. **Untested**: an unknown GitHub account → `byok` (needs a 2nd account).
      - Gotcha: first attempt failed `account_not_linked` — Better Auth's `requireLocalEmailVerified`
        (default true) blocks linking to an UNVERIFIED local account. The legacy M5 row was unverified;
        invite-created accounts already set `emailVerified: true`. Fixed the row, not the default.
- [x] **Email path** (allowlist only): sign-in form = email + password (show/hide toggle). Replaces
      today's sign-in/sign-up toggle. **Open sign-up disabled** — knowing an allowlisted email isn't enough.
- [x] **One-time invite link**: `invite(email)` → random token, store **hash** + email + expiresAt (48h)
      + usedAt; `/invite/<token>` → "Set a password" (email fixed by the token) → account created,
      `usedAt` set, link dead. Same link type with `reset` for forgotten passwords.
      - Done: `invite` table (0009), `admin/invites.ts` (create/peek/accept), `GET|POST /invite/:token`,
        `bun run invite <email> [--reset]` (moved from packages/db). New link burns the previous one.
- [x] Screen: wordmark · one line · **Continue with GitHub** · quiet "Invited by email? Sign in →".
      - Plus `/invite/<token>` screen (password shown by default — a typo there locks you out).
- [x] Tests: allowlisted GitHub → unlimited; unknown GitHub → byok; sign-up without token rejected;
      invite link used/expired rejected; reset link replaces password.
      - `invites.test.ts` (8, real Better Auth ctx) + browser run: invite → signed in; reuse → expired.
        GitHub half is covered by `accessForNewUser` only — the OAuth round trip is untested.

### 7c Guest links
- [x] `guest_link(tokenHash, userId, expiresAt, revoked)`; `/g/<token>` → mints a Better Auth
      session for that guest account on **every** visit (reusable: any device, any number of opens —
      all share one account and its 60 steps; forwarding can't multiply cost).
      - Done via Better Auth's **magic-link plugin** (`disableSignUp`, 120s): each visit mints a
        single-use token server-side (captured, never emailed); Better Auth sets the cookie on the
        verify redirect — no hand-built session. Table 0010.
- [x] CLI `bun run guest-link ["label"] [--steps] [--days]` prints the URL; `--list`, `--revoke <id>`.
- [x] Tests: reopen + second device land in the same account; revoked/expired rejected.
      - `guests.test.ts` (3) + browser: two contexts on one link → same account, device 2 sees device 1's
        project, tier guest 5 steps.

### 7d Prune (original manual implementation; automation added in spec 13)
- [x] Access expiry is automatic (7a). The initial release used manual deletion; spec 13 adds
      a daily CLI-based CronJob after a seven-day post-expiry retention period.
- [x] Migration: `ON DELETE CASCADE` on `project.user_id`, `message.project_id`,
      `snapshot.project_id` (today none cascade → deleting a user errors).
      - Done: 0008 (+ `allowlist.invited_by` SET NULL); `packages/db/src/cascade.test.ts`.
- [x] `bun run prune-guests --older-than 7d` — **CLI only, never `/admin`** (`kubectl exec` once deployed):
      **dry run by default** (accounts, projects, deployments, R2 bytes); `--yes` → verified Vercel
      projects, then the expired account's R2 prefixes, then `DELETE user` (cascades).
      Never touches allowlist tier.
      - `admin/prune.ts` (findPruneCandidates / prune / parseAge) + `scripts/prune-guests.ts`.
- [x] External resources are deleted before Postgres; a failure preserves database references for retry.
      Partial external deletion is not atomic and cannot be rolled back. Spec 13 adds Vercel cleanup
      and re-checks eligibility before deletion.
- [x] Tests: dry run deletes nothing; allowlist untouched; `--yes` removes rows + R2 prefix.
      - `prune.test.ts` (4, real R2 + PG); allowlist excluded in SQL, not filtered later.

### 7e Provider adapters
- [x] **OpenAI-compatible adapter** (base URL + model): DeepSeek, OpenAI, Gemini. Refactor
      `DeepSeekProvider` into it.
      - `openaiCompatible.ts`; `echoReasoning` per provider (DeepSeek 400s without it). Old DeepSeek
        folder + `config.ts` deleted. Live check: real DeepSeek call, plain + tool round.
- [x] **Claude adapter** (Messages API, `tool_use` blocks); load the claude-api reference first; model
      IDs from docs.
      - `claude.ts`: system lifted out of turns, tool_result blocks in one user turn, thinking blocks
        stored in `reasoningContent` as JSON and replayed verbatim, refusal → error. Default `claude-opus-5`.
        **Not exercised live** (no ANTHROPIC_API_KEY here) — mocked HTTP only.
- [x] Session picks provider + key at create time.
      - `createProvider({provider, apiKey, model, effort})`; `serverProvider()` = `ORIN_PROVIDER` (default
        deepseek) + its env key. OpenAI/Gemini have no default model — set `ORIN_MODEL` (no guessed ids).
- [x] Tests: request/response translation per adapter (mocked HTTP), incl. tool calls.
      - `providers.test.ts` (11) + `wire.test.ts` (10, stubbed transport: body sent, tool calls, usage,
        refusal, length cap, HTTP error → error result).

### 7f BYOK flow
- [x] BYOK home: "Add an API key to start" (provider + key) above the composer.
      - `ByokKeyForm`: provider chips + key + model, with **fast/flash models suggested first**
        (deepseek v4.1-flash, claude-haiku-4-5, gemini flash `unverified`) — an agent loop makes many
        small calls. OpenAI/Gemini ids stay editable; none invented.
- [x] **Validate with a cheap call** before accepting; key held in the live session only; re-prompt
      when the session is gone.
      - `persistence/byok.ts` (in-memory Map, no getter for the raw key) + `POST|DELETE /byok`;
        `/me` reports `needsKey`. Live: a bad key → DeepSeek's own 401 wording, nothing stored.
- [x] Global cap on concurrent limited-tier sandboxes.
      - `GUEST_SANDBOX_CAP` (`ORIN_MAX_GUEST_SANDBOXES`, default 3) over live limited sessions;
        reattaching an already-live project is always allowed. Stream yields `busy` at the cap.
- [x] Tests: key never reaches DB / events / logs / sandbox env; invalid key rejected; cap enforced.
      - `byok.test.ts` (6, incl. a DB dump that must not contain the key) + `liveSessions.test.ts` (2).
        Sandbox env: nothing passes `envs` to E2B — the key only ever reaches the provider SDK.

### 7g Admin page (after 7c)
- [x] One admin module (`admin/{guests,invites,usage}.ts`); `scripts/*` CLIs and `/admin` routes both
      call it — no logic in either entry point.
- [x] Admin ≠ allowlist: `ADMIN_EMAILS` env, checked **server-side on every `/admin` route** off the
      Better Auth session (not a hidden button, not a shared secret typed into the UI).
      - Turbo 2 runs tasks in strict env mode → `passThroughEnv` in `turbo.json` for local `bun run dev`;
        in Docker/k8s the var comes from env_file/secrets and turbo isn't involved.
- [x] `/admin` UI: guest links (create → copy URL, list with steps used / expiry, revoke), invite +
      reset links, usage table. **No delete/prune here.** Screenshot checked.
- [x] Tests: non-admin session → 403 on every route; allowlisted non-admin → 403; admin can create/revoke.
      - `admin.test.ts` (4, real HTTP + cookies).

## Out of scope → spec 8
- **Deploy** (`ops/orin-app-k8s`: Dockerfiles, manifests, sops secrets, ingress/TLS, migrate job).
  Recruiters and visitors can't reach Orin until then; 7 is built and tested locally.
- **Domains**: web `orin.ashutoshsao.com`, api `api.orin.ashutoshsao.com` → `BETTER_AUTH_URL` +
  `WEB_ORIGIN` per env, and the session cookie becomes **cross-subdomain** → Better Auth
  `advanced.crossSubDomainCookies` with the parent domain (find this now, not while debugging k8s).
- **GitHub OAuth redirect URIs**: one app covers both — GitHub's OAuth app form now takes up to 10
  redirect URIs (the docs page still describes the single-callback rule; the form is the truth).
  dev `http://localhost:4000/api/auth/callback/github` (= `BETTER_AUTH_URL` + the Better Auth path),
  prod `https://api.orin.ashutoshsao.com/api/auth/callback/github`. Wildcard matching stays OFF.
  Split into a second app only to rotate the prod secret independently.
- **R2: one shared snapshots bucket** (reversed after review). Every key is `users/<id>/` or `guests/<id>/`
  and every delete is prefix-scoped; dev and prod have separate DBs so ids can't collide, and sharing keeps
  existing snapshots reachable. Only `orin-db-backups` is new. Risk to respect: don't point a local
  destructive script at the prod DATABASE_URL.
- Landing page → future-considerations.

## Decisions
- Guest link = **reusable key to one account**, not single-use (recruiters reopen, switch devices).
- BYOK visitors sign in with **GitHub** (costly to farm budgets); key **session-only**.
- Email + password kept **only** for allowlisted people without GitHub (Devyanshi).
- Storage: last 2 full bundles, rewind by commit hash — simpler than delta bundles at 45–80 KB.
- **Access expires automatically; scheduled cleanup follows seven days later** (spec 13).
  `prune-guests` stays dry by default for manual previews; only `--yes` deletes data.
- Admin = **one module, two entry points**: `/admin` for frequent, low-risk actions (guest links,
  invites, usage — works from a phone); CLI via `kubectl exec` (no port-forward) for everything, and
  the same `prune-guests` CLI is used by the scheduled cleanup Job (no public deletion endpoint).
- Admin check = `ADMIN_EMAILS` against the session, not perps' shared `ADMIN_SECRET` header (that fits
  a bot caller; for humans it's a password typed in the browser, no identity, `!==` compare).
- Allowlist sign-up only via **one-time invite link** — the allowlisted email alone is public, not a secret.

## Open
- ~~Global cap~~ → built (7f), default 3 via `ORIN_MAX_GUEST_SANDBOXES`.
- An unknown GitHub account → `byok` tier is still unverified (needs a second GitHub account).
- **Claude = BYOK only** (decided): the server builds with DeepSeek, so no `ANTHROPIC_API_KEY` server-side
  and no cost to us. The Claude adapter therefore stays covered by mocked HTTP only until a visitor
  brings an Anthropic key — worth one real run then.
