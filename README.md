# Orin

Orin is a Lovable-style AI app builder, live at [orin.ashutoshsao.com](https://orin.ashutoshsao.com): you
describe an app in plain language, and an agent scaffolds and builds it live inside an isolated cloud
sandbox, streaming its progress to your browser and serving the running app back in an iframe.

## What's built

- **Provider-agnostic agent loop**: one `LLMProvider` interface with adapters for OpenAI-compatible
  APIs (DeepSeek, Gemini) and Claude's Messages API. Provider-specific shapes never leak into the loop.
- **Crash-safe builds**: at every round boundary the sandbox's code is git-committed and bundled, and a
  background worker pushes it to Cloudflare R2 off the hot path. A dropped connection or dead sandbox
  resumes from the last durable round, or rewinds to any earlier step.
- **Resumable sessions**: one live session per project, owned by the server rather than the connection.
  Events carry ids and a replay buffer, so a browser can reconnect mid-build and catch up.
- **Access tiers**: invite allowlist, reusable guest links, and bring-your-own-key, with step budgets
  enforced atomically in Postgres before every LLM call (fail closed).
- **Deployed** on Kubernetes (GKE) with nightly Postgres backups verified by restore; web on Vercel.

## How it works

```
browser (apps/web) ──prompt──▶ Elysia server (apps/api) ── live session per project (SSE, replayable)
     ▲                              │
     │                              ▼
 event feed +                 Agent loop ──▶ LLMProvider ──▶ OpenAI-compatible (DeepSeek, Gemini)
 <iframe> preview                  │                     └─▶ Claude (Messages API)
     │                              ▼
     └───── preview URL ◀── E2B sandbox ── round boundary ──▶ git bundle ──▶ Redis queue ──▶ R2
                                                         └──▶ context rows ──▶ Postgres
```

- **Agent loop** (`apps/api/src/agent`) owns the cycle: call the LLM → run any requested tool calls →
  feed results back → repeat until a final answer. Every side effect (persistence, snapshots, budget)
  is an injected callback, so the loop stays DB- and HTTP-agnostic.
- **Sandbox**: each session boots its own E2B sandbox from a custom template that pre-bakes a
  Vite + React workspace and its dependencies. The agent's tools execute inside it, so nothing
  touches the host filesystem.
- **Transport**: agent events stream to the browser as Server-Sent Events.

## Layout

| Path | What it is |
|---|---|
| `apps/api` | Agent orchestration + the Elysia SSE server. The heart of the project. |
| `apps/web` | Vite + React UI: prompt in, live event feed, preview iframe. |
| `apps/react-template` | Standalone Vite + React app copied into the sandbox as the build workspace. |
| `apps/orin-react-workspace` | E2B template definition (`template.ts`) that bakes `react-template` into a sandbox image. |
| `packages/*` | Shared `ui`, `eslint-config`, and `typescript-config`. |

## Getting started

Prerequisites: [Bun](https://bun.sh), an [E2B](https://e2b.dev) account + API key, and a
[DeepSeek](https://platform.deepseek.com) API key.

```sh
bun install
```

Set the API keys (Bun auto-loads `.env` from each app's own directory):

```sh
# apps/api/.env
DEEPSEEK_API_KEY=...
E2B_API_KEY=...

# apps/orin-react-workspace/.env
E2B_API_KEY=...
```

Build the sandbox template once (produces the image the agent boots from):

```sh
cd apps/orin-react-workspace && bun run e2b:build:dev
```

### Run it

From the CLI (one-shot build, logs to stdout):

```sh
cd apps/api && bun src/agent/run.ts
```

With a live preview (keeps the sandbox alive and prints a browser URL):

```sh
cd apps/api && bun src/agent/preview.ts
```

In the browser (two terminals):

```sh
cd apps/api && bun src/server.ts   # agent SSE server → http://localhost:4000
cd apps/web && bun run dev         # UI → http://localhost:5173
```

Then open http://localhost:5173, enter a prompt, and watch it build.

## Stack

Bun + Turborepo · Vite + React · Elysia (SSE) · E2B (sandboxes) · PostgreSQL + Drizzle · Redis ·
Cloudflare R2 · OpenAI-compatible and Claude APIs · Kubernetes (GKE)
