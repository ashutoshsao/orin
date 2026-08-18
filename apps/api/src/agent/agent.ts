import { Sandbox } from "e2b";
import { ContextType, LLMProvider, MessageType } from "./types";
import { toolExecution, tools, WORKDIR } from "./tools";
import { config } from "./config";

const TEMPLATE = "orin-react-workspace-dev";

// Anchors the agent to the actual workspace: it must EDIT the live Vite React app
// (what the preview serves), not freelance a standalone file. Without this the
// model tends to write e.g. a self-contained todo.html that never shows up in the
// preview (which serves index.html → src/main.tsx → src/App.tsx via `bun run dev`).
const SYSTEM_PROMPT = `You are Orin, an expert web app builder.

You work inside a Bun + Vite + React + TypeScript app at /home/user/react-template. It uses Bun as the package manager and its dependencies are already installed — use \`bun add <pkg>\` / \`bunx\`, never npm/yarn/pnpm. Orin runs this app and shows it to the user in a live preview that hot-reloads as you edit — you do NOT need to start, run, or verify a dev server yourself; just edit the app's files and the preview updates.

Your job: build what the user asks by modifying this app. The whole project is yours — edit or create any files (components and modules under src/, styles, index.html, config) and install dependencies with \`bun add <pkg>\` whenever you need them. The app's entry chain is index.html → src/main.tsx → src/App.tsx.

Rules:
- Build into THIS running app, not a separate one. Do NOT create standalone/disconnected .html files — a change only shows in the preview if it's part of this Vite React app (reachable from index.html / src/main.tsx).
- Use bash_tool to inspect and write files (cat to read; write with a heredoc, e.g. cat > src/App.tsx <<'EOF' ... EOF) and to run \`bun add\` for new deps. Re-read a file to confirm your edit landed.
- Keep the app compiling and runnable; write real, complete React + TypeScript.
- If the request is ambiguous (scope, style, tech choice), use ask_user to ask instead of assuming.`;
// agent is never cut off mid-build. This is only a safety ceiling — `close()` in
// the `finally` kills the sandbox as soon as a run finishes normally.
const SANDBOX_TIMEOUT_MS = 60 * 60_000;

// One structured agent event. Same shape that's logged to stdout and, when a sink
// is provided, handed to `onEvent` — the seam the SSE transport taps without the
// loop ever knowing about HTTP.
export type AgentEvent = {
  ts: string;
  sessionId: string;
  event: string;
  [key: string]: unknown;
};

// How a session receives events and persists messages, plus an optional context to
// resume from. Passed to `create` — keeps the loop unaware of HTTP and the DB.
export type CreateOptions = {
  onEvent?: (event: AgentEvent) => void;
  // Persist a batch of newly-appended messages; `startSeq` is their index in context.
  persist?: (messages: MessageType[], startSeq: number) => Promise<void>;
  // Seed context from a prior project (resume); replaces the default [system].
  initialContext?: ContextType;
};

export class AgentSession {
  private context: ContextType;
  private sessionId: string;
  // One turn at a time: `running` guards the drain loop, `pending` holds prompts
  // that arrived while a turn was in flight (applied at the next turn boundary).
  private running = false;
  private pending: string[] = [];
  // Set on close() so an in-flight loop stops instead of hammering the LLM against
  // a dead sandbox after the client disconnects.
  private closed = false;
  // ask_user calls parked mid-turn, keyed by the tool_call id; resolved by answer().
  private pendingQuestions = new Map<string, (answer: string) => void>();
  // How many context messages are already persisted, so flush() only writes the tail.
  private persistedCount = 0;

  // Private: the only way to get a session is via `create`, which guarantees the
  // sandbox is already booted — so `sandbox` is never null and never half-ready.
  private constructor(
    private llmProvider: LLMProvider,
    private sandbox: Sandbox,
    private onEvent?: (event: AgentEvent) => void,
    private persist?: (messages: MessageType[], startSeq: number) => Promise<void>,
  ) {
    this.sessionId = crypto.randomUUID();
    this.context = [
      { role: "system", content: SYSTEM_PROMPT },
    ];
  }

  // Async construction: `await Sandbox.create(...)` can't live in a constructor,
  // so it lives here and the session isn't returned until the sandbox is live.
  // `onEvent`/`persist` are how transports/DB tap in; `initialContext` resumes a project.
  static async create(llmProvider: LLMProvider, opts: CreateOptions = {}) {
    const sandbox = await Sandbox.create(TEMPLATE, { timeoutMs: SANDBOX_TIMEOUT_MS });
    const session = new AgentSession(llmProvider, sandbox, opts.onEvent, opts.persist);
    if (opts.initialContext && opts.initialContext.length > 0) {
      // Resume: loaded messages (incl. the original system prompt) are already
      // persisted, so start the tail after them.
      session.context = [...opts.initialContext];
      session.persistedCount = session.context.length;
    }
    // Fresh session leaves persistedCount at 0, so the system prompt persists too.
    session.log("sandbox_created", { sandboxId: sandbox.sandboxId, template: TEMPLATE });
    return session;
  }

  // Persist the not-yet-saved tail of context. Called at each round boundary (never
  // mid-round), so a saved state is always a valid, resumable one. Best-effort: a
  // persist failure is logged, not thrown, and retried on the next flush.
  private async flush() {
    if (!this.persist) return;
    const tail = this.context.slice(this.persistedCount);
    if (tail.length === 0) return;
    try {
      await this.persist(tail, this.persistedCount);
      this.persistedCount = this.context.length;
    } catch (e) {
      this.log("persist_error", { message: String(e) });
    }
  }

  // Sandboxes are live VMs on E2B's infra — kill it when the session is done.
  async close() {
    this.closed = true; // stop any in-flight loop before/while we tear down
    // Flush parked ask_user promises so a loop awaiting an answer unwinds instead
    // of hanging forever; the `closed` check then ends the loop at its next step.
    for (const resolve of this.pendingQuestions.values()) resolve("");
    this.pendingQuestions.clear();
    await this.sandbox.kill();
    this.log("sandbox_closed", { sandboxId: this.sandbox.sandboxId });
  }

  // Start the dev server and hand back a public URL. `--host` binds Vite to
  // 0.0.0.0 so E2B's proxy can reach it (localhost-only wouldn't be reachable);
  // `background` so it doesn't block. Then we *independently* poll the server
  // (our own check, not the model's claim) before returning the getHost URL.
  async startPreview(port = 8080): Promise<{ url: string; httpStatus: string }> {
    await this.sandbox.commands.run(`bun run dev --host --port ${port}`, {
      cwd: WORKDIR,
      background: true,
    });

    const url = `https://${this.sandbox.getHost(port)}`;

    // Probe the PUBLIC url from here (the orchestrator), not localhost inside the
    // sandbox — this exercises the full path (E2B proxy → Vite host check → app),
    // which is exactly what the browser hits. A localhost probe would bypass the
    // host check and give false confidence.
    let httpStatus = "no-response";
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(url);
        httpStatus = String(res.status);
        if (res.ok) break;
      } catch {
        // proxy/server not ready yet — retry
      }
      await Bun.sleep(500);
    }

    this.log("preview_ready", { port, url, httpStatus });
    return { url, httpStatus };
  }

  // Stable id for the session registry / routing follow-up POSTs to this session.
  get id() {
    return this.sessionId;
  }

  // Submit a prompt (initial or follow-up). If a turn is already running, the
  // prompt is queued and picked up at the next turn boundary — never injected
  // mid-loop (that would risk the tool_calls→result invariant). Resolves when the
  // queue has fully drained (i.e. the session is idle again).
  async submit(prompt: string) {
    this.pending.push(prompt);
    if (this.running) return; // an active drain loop will pick it up at the boundary
    this.running = true;
    try {
      while (this.pending.length && !this.closed) {
        await this.run(this.pending.shift()!);
      }
    } finally {
      this.running = false;
    }
  }

  // Called by the ask_user tool: emit the question as an event, then park a promise
  // keyed by the tool_call id. The loop's `await` on the tool holds here until the
  // user answers (or close() flushes pending questions on disconnect).
  private askUser(callId: string, question: string, options: string[]): Promise<string> {
    this.log("ask_user", { callId, question, options });
    return new Promise<string>((resolve) => {
      this.pendingQuestions.set(callId, resolve);
    });
  }

  // Called by the transport when the user's answer arrives. Resolves the parked
  // promise → the answer becomes the tool result → the loop resumes.
  answer(callId: string, text: string): boolean {
    const resolve = this.pendingQuestions.get(callId);
    if (!resolve) return false;
    this.pendingQuestions.delete(callId);
    resolve(text);
    return true;
  }

  private log(event: string, data: Record<string, unknown> = {}) {
    const entry: AgentEvent = { ts: new Date().toISOString(), sessionId: this.sessionId, event, ...data };
    console.log(JSON.stringify(entry));
    this.onEvent?.(entry);
  }

  async run(userPrompt: string) {
    this.context.push({
      role: "user", content: userPrompt
    })

    this.log("run_start", { userPrompt })

    let start = parseInt(config.initIteration)
    let end = parseInt(config.maxIteration)

    while (start <= end && !this.closed) {

      const llmStart = performance.now();
      const response = await this.llmProvider.callLLM(this.context, tools);
      const llmDurationMs = Math.round(performance.now() - llmStart);

      this.log("llm_call", { iteration: start, status: response.status, durationMs: llmDurationMs, usage: response.usage })

      if (response.status === "done") {

        this.context.push({ role: "assistant", content: response.content });
        this.log("final", { iteration: start, content: response.content });
        await this.flush();
        break;

      } else if (response.status === "toolCall") {

        this.context.push({
          role: "assistant", content: response.content
        })

        const toolStart = performance.now();
        const toolResponse = await toolExecution(response.content.toolCalls, {
          sandbox: this.sandbox,
          askUser: (callId, question, options) => this.askUser(callId, question, options),
        })
        const toolDurationMs = Math.round(performance.now() - toolStart);

        this.context.push({
          role: "tool", content: toolResponse
        })

        this.log("tool_call", {
          iteration: start,
          durationMs: toolDurationMs,
          tools: response.content.toolCalls.map((t, i) => ({ name: t.name, ok: toolResponse[i].ok }))
        })

        // Round complete (assistant tool_calls + tool results both appended) —
        // persist them together, keeping the saved log always valid.
        await this.flush();

      } else if (response.status === "error") {
        this.log("error", { iteration: start, content: response.content });
        break;
      } else {
        this.log("exception", { iteration: start, content: response.content });
        break;
      }

      start++
    }

    if (start > end) {
      this.log("max_iterations_reached", { iteration: start });
    }
  }
}
