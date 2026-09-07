# Orin

Orin is a Lovable-style AI app builder: you describe an app in plain language, and an agent scaffolds
and builds it live inside an isolated cloud sandbox — streaming its progress to your browser and
serving the running result back in an iframe.

The current focus is proving the core agent loop end to end before layering product infrastructure
around it. Today Orin can take a one-line prompt, run a multi-step tool-calling loop against a real
LLM, execute the tool calls inside a per-session [E2B](https://e2b.dev) sandbox, and hand back a live
preview URL — driven either from the CLI or from a browser over SSE.

## How it works

```
browser (apps/web) ──prompt──▶ Elysia SSE endpoint (apps/api)
     ▲                              │  creates an AgentSession
     │                              ▼
 event feed +                 Agent loop ──▶ LLMProvider ──▶ DeepSeek (OpenAI SDK, Chat Completions)
 <iframe> preview                  │              tool calls
     │                              ▼
     └───── preview URL ◀── E2B sandbox (bash_tool runs here; Vite dev server via getHost)
```

- **Agent loop** (`apps/api/src/agent`) owns the cycle: call the LLM → run any requested tool calls →
  feed results back → repeat until a final answer. It never sees provider-specific shapes — those stay
  behind an `LLMProvider` interface (`DeepSeekProvider` today).
- **Sandbox** — each `AgentSession` boots its own E2B sandbox from a custom template that pre-bakes a
  Vite + React workspace and its dependencies. The agent's `bash_tool` executes inside it, so nothing
  touches the host filesystem. The sandbox is torn down when the session ends (or the browser
  disconnects).
- **Transport** — agent events stream to the browser as Server-Sent Events. Not GraphQL subscriptions;
  SSE is the event transport (a GraphQL CRUD layer may come later).

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

Bun + Turborepo · Vite + React · Elysia (SSE) · E2B (sandboxes) · DeepSeek via the OpenAI SDK
(Chat Completions).
