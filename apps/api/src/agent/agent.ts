import { Sandbox } from "e2b";
import { ContextType, LLMProvider, MessageType } from "./types";
import { toolExecution, tools, WORKDIR } from "./tools";
import { config } from "./config";
import { freshRepairState, nextRepair, type RepairState } from "./repairPolicy";
import { oversizeNote, SNAPSHOT_MAX_BYTES, snapshotRound } from "./snapshot";
import { startDevServer, type DevServerHandle } from "./devServer";
import { connectHmr, moduleUrlPath, type HmrListener } from "./hmrListener";
import type { RestorePoint } from "../persistence/store";

const TEMPLATE = "orin-react-workspace-dev";
// Metadata stamped on every sandbox this API creates, so a freshly booted server can find
// (and kill) the ones a crashed predecessor left running — see sandbox/sweep.ts.
export const SANDBOX_TAG = { app: "orin-api" };

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

// What the feed shows for a tool call: the command the model actually asked for, not an
// interpretation of it. Deriving meaning was the first idea and the data killed it — of 228 real
// commands, 99% were chained with `&&`, 95% began with `cd`, and they averaged 2.4 KB (max 36 KB)
// because writing a file is a heredoc. So any verb→label mapping would have said "changed
// directory" almost every time.
//
// FIRST LINE, because a heredoc's first line ends at the `<<'EOF'` marker — exactly the useful
// part — and the rest is the file being written. Capped because this rides in every SSE event and
// Postgres row, and because a 36 KB heredoc body has no business in either.
const COMMAND_LINE_MAX = 160;
export function commandLine(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const first = command.split("\n", 1)[0]!.trim();
  return first.length > COMMAND_LINE_MAX ? `${first.slice(0, COMMAND_LINE_MAX)}…` : first;
}

// How much dev-server stderr to hand the agent. Enough for Vite's startup error with its
// stack, bounded so a crash loop can't flood the context window.
const DEV_SERVER_STDERR_CHARS = 2_000;

// One structured agent event. Same shape that's logged to stdout and, when a sink
// is provided, handed to `onEvent` — the seam the SSE transport taps without the
// loop ever knowing about HTTP.
export type AgentEvent = {
  ts: string;
  sessionId: string;
  event: string;
  [key: string]: unknown;
};

// One round's codebase snapshot handed to the queue. `push` = files changed (carries the
// bundle bytes + commit); `mark` = no file change this round (lets the durable marker
// advance in order without an R2 write). `n` is the context length the round covers.
export type SnapshotJob =
  | { kind: "push"; commitHash: string; bundle: Uint8Array; n: number }
  | { kind: "mark"; commitHash: string; n: number };

// Per-account step budget (7a): one step = one LLM call, reserved before the call and
// refunded if the provider fails. Provider-/DB-agnostic — the server wires it to Postgres.
export type StepBudget = {
  reserve: () => Promise<{ ok: true } | { ok: false; reason: "steps" | "expired" | "no_access" }>;
  refund: () => Promise<void>;
};

// Saved (and shown) when a run stops for budget. apps/web/src/lib/events.ts recognises this
// wording to render it after a reopen — keep the two in step.
const BUDGET_NOTES = {
  steps: "This trial's step budget is used up, so I stopped here. Everything built so far is saved.",
  expired: "This account's access has expired, so I stopped here. Everything built so far is saved.",
  no_access: "This account has no build access, so I stopped here.",
} as const;

// How a session receives events and persists messages, plus an optional context to
// resume from. Passed to `create` — keeps the loop unaware of HTTP and the DB.
export type CreateOptions = {
  onEvent?: (event: AgentEvent) => void;
  // Persist a batch of newly-appended messages; `startSeq` is their index in context.
  persist?: (messages: MessageType[], startSeq: number) => Promise<void>;
  // Enqueue a per-round codebase snapshot for the background worker to push to R2
  // off the hot path (M5b). `push` carries the bundle; `mark` records a no-op round so
  // the durable marker can still advance. The worker owns durableCodebaseN.
  enqueueSnapshot?: (job: SnapshotJob) => Promise<void>;
  // Seed context from a prior project (resume); replaces the default [system].
  initialContext?: ContextType;
  // Fetch the latest codebase snapshot bundle to rehydrate the sandbox on resume, or
  // null if the project has none (M5b). Called once after the sandbox boots.
  restoreSnapshot?: () => Promise<RestorePoint | null>;
  // Omitted = unmetered (CLI harnesses).
  stepBudget?: StepBudget;
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
  // Latest per-round git commit in the sandbox (M5b). null until the first snapshot;
  // used as the commit a `mark` (no-op round) refers to. The worker owns durability.
  private latestCommit: string | null = null;
  private stepBudget?: StepBudget;
  // The running dev server, kept so the loop can notice it died after we stopped waiting.
  private devServer?: DevServerHandle;
  // Watches the app's compile errors over Vite's HMR socket (spec 9). null when we couldn't
  // attach — the build carries on without it.
  private hmr?: HmrListener | null;
  private previewPort = 8080;
  // Attempts remaining for the CURRENT breakage, shared by both repair paths (dead dev server,
  // compile error). It refills the moment the app is proven healthy again, so the budget is per
  // incident, not per session: a break at step 5 that cost two tries must not leave a break at
  // step 50 silently unfixed. Breaks are rare, so in practice this is "two tries, then ask".
  private repair: RepairState = freshRepairState();

  // Private: the only way to get a session is via `create`, which guarantees the
  // sandbox is already booted — so `sandbox` is never null and never half-ready.
  private constructor(
    private llmProvider: LLMProvider,
    private sandbox: Sandbox,
    private onEvent?: (event: AgentEvent) => void,
    private persist?: (messages: MessageType[], startSeq: number) => Promise<void>,
    private enqueueSnapshot?: (job: SnapshotJob) => Promise<void>,
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
    const sandbox = await Sandbox.create(TEMPLATE, { timeoutMs: SANDBOX_TIMEOUT_MS, metadata: SANDBOX_TAG });
    const session = new AgentSession(llmProvider, sandbox, opts.onEvent, opts.persist, opts.enqueueSnapshot);
    session.stepBudget = opts.stepBudget;
    if (opts.initialContext && opts.initialContext.length > 0) {
      // Resume: loaded messages (incl. the original system prompt) are already
      // persisted, so start the tail after them.
      session.context = [...opts.initialContext];
      session.persistedCount = session.context.length;
    }
    // Fresh session leaves persistedCount at 0, so the system prompt persists too.
    session.log("sandbox_created", { sandboxId: sandbox.sandboxId, template: TEMPLATE });
    // Resume with files: rehydrate the workspace from the last pushed snapshot, so the
    // agent (and preview) continue from the actual codebase, not the bare template.
    if (opts.restoreSnapshot) {
      const point = await opts.restoreSnapshot();
      if (point) await session.restore(point);
    }
    return session;
  }

  // Rehydrate the workspace from a snapshot bundle (M5b). The sandbox already holds the
  // baked template repo (same base commit the bundle extends), so we fetch the bundle's
  // history into it and hard-reset the working tree to the target commit — the bundle's
  // HEAD, or an older commit in its history after a rewind (7.1) — reusing the existing
  // .git and node_modules. Then `bun install` reconciles any deps the agent added since
  // the base (node_modules is gitignored, so it isn't in the bundle).
  private async restore({ bundle, commit }: RestorePoint) {
    try {
      const bundlePath = "/tmp/restore.bundle";
      // Only a full hash from our own DB is interpolated into the shell; anything else
      // falls back to the bundle's HEAD.
      const target = commit && /^[0-9a-f]{40}$/.test(commit) ? commit : "FETCH_HEAD";
      // files.write takes string | ArrayBuffer | Blob | ReadableStream (not a raw
      // Uint8Array), so wrap the bytes in a Blob.
      await this.sandbox.files.write(bundlePath, new Blob([bundle]));
      const reset = await this.sandbox.commands
        .run(`git fetch -q ${bundlePath} HEAD && git reset -q --hard ${target} && git rev-parse HEAD`, { cwd: WORKDIR })
        .finally(() => this.sandbox.commands.run(`rm -f ${bundlePath}`).catch(() => {}));
      await this.sandbox.commands.run("bun install", { cwd: WORKDIR });
      // HEAD now equals the snapshot we restored from; seed latestCommit so a no-op first
      // round can `mark` against it. durableCodebaseN in the DB already reflects this point.
      const head = reset.stdout.trim();
      this.latestCommit = head;
      this.log("snapshot_restored", { bytes: bundle.length, commit: head });
    } catch (e) {
      // Non-fatal: fall back to the bare template. Log so it's visible in the feed.
      this.log("snapshot_restore_error", { message: String(e) });
    }
  }

  // Persist the not-yet-saved tail of context. Called at each round boundary (never
  // mid-round), so a saved state is always a valid, resumable one. Best-effort: a
  // persist failure is logged, not thrown, and retried on the next flush.
  private async flush() {
    // A closed session must never write. close() only stops the loop at its next check,
    // so a round already in flight (mid LLM call or tool run) would otherwise finish and
    // save itself — after a reconnect's new session has loaded the history and taken
    // those same seq numbers. That interleaved two sessions' rows and left a tool_calls
    // message without its results, which the provider then rejects (400).
    if (!this.persist || this.closed) return;
    const tail = this.context.slice(this.persistedCount);
    if (tail.length === 0) return;
    try {
      await this.persist(tail, this.persistedCount);
      this.persistedCount = this.context.length;
    } catch (e) {
      this.log("persist_error", { message: String(e) });
    }
  }

  // Snapshot the workspace as one round's git commit and build its bundle (M5b; see
  // snapshot.ts). Returns { hash, bundle } when files changed, or null for a no-op round
  // (ask_user / final-only — git has nothing to commit) or an oversize one. Best-effort: a
  // git hiccup is logged, not thrown, so it can never block context persistence.
  // Must run BEFORE flush(): an oversize note is appended to this round's tool result.
  private async snapshot(): Promise<{ hash: string; bundle: Uint8Array } | null> {
    try {
      const snap = await snapshotRound(this.sandbox);
      if (snap.kind === "nochange") return null;
      this.latestCommit = snap.hash;
      if (snap.kind === "oversize") {
        // Not pushed: enqueueRound sends a `mark` for this unpushed hash, which the worker
        // won't honour, so durableCodebaseN stays put and resume clamps to the last saved
        // round. Tell the model (when it has a next call to see it) so it can shrink the repo.
        const last = this.context[this.context.length - 1];
        if (last?.role === "tool" && last.content.length) {
          const result = last.content[last.content.length - 1];
          result.content = `${result.content}\n\n${oversizeNote(snap.bytes)}`;
        }
        this.log("snapshot_skipped", { commit: snap.hash, bytes: snap.bytes, maxBytes: SNAPSHOT_MAX_BYTES });
        return null;
      }
      this.log("snapshot", { commit: snap.hash, bytes: snap.bundle.length });
      return { hash: snap.hash, bundle: snap.bundle };
    } catch (e) {
      this.log("snapshot_error", { message: String(e) });
      return null;
    }
  }

  // Hand the round to the snapshot queue (non-blocking). Called AFTER flush() so context
  // is already durable: a crash before enqueue just leaves the round un-pushed → the
  // clamp discards it on resume (safe). A `push` carries the bundle for the worker to send
  // to R2; a no-op round enqueues a `mark` so the durable marker can still advance in
  // order (the worker only honours it if HEAD is durably pushed).
  private async enqueueRound(snap: { hash: string; bundle: Uint8Array } | null) {
    if (!this.enqueueSnapshot || this.closed) return; // same rule as flush(): dead sessions don't write
    try {
      if (snap) {
        await this.enqueueSnapshot({ kind: "push", commitHash: snap.hash, bundle: snap.bundle, n: this.persistedCount });
      } else if (this.latestCommit) {
        await this.enqueueSnapshot({ kind: "mark", commitHash: this.latestCommit, n: this.persistedCount });
      }
    } catch (e) {
      this.log("enqueue_error", { message: String(e) });
    }
  }

  // Sandboxes are live VMs on E2B's infra — kill it when the session is done.
  async close() {
    this.closed = true; // stop any in-flight loop before/while we tear down
    // Flush parked ask_user promises so a loop awaiting an answer unwinds instead
    // of hanging forever; the `closed` check then ends the loop at its next step.
    for (const resolve of this.pendingQuestions.values()) resolve("");
    this.pendingQuestions.clear();
    this.hmr?.close();
    await this.sandbox.kill();
    this.log("sandbox_closed", { sandboxId: this.sandbox.sandboxId });
  }

  // Start the app's dev server and wait for the preview to answer. The waiting lives in
  // devServer.ts (testable, no live VM); this turns its outcome into events. All three
  // outcomes are reported — "it never came up" is information the user needs, not silence.
  async startPreview(port = 8080): Promise<{ url: string; httpStatus: string }> {
    this.previewPort = port;
    const outcome = await startDevServer(this.sandbox, {
      port,
      onStarted: (handle) => { this.devServer = handle; },
      onProgress: (p) => this.log("preview_waiting", { port, url: p.url, ms: p.ms, httpStatus: p.httpStatus }),
    });
    switch (outcome.kind) {
      case "ready":
        // The server is up and answering. If this was a restart after a crash, that incident is
        // over — refill. A restart that fails returns "exited" instead, so a crash loop can't
        // refill itself here.
        this.repair = freshRepairState();
        this.log("preview_ready", { port, url: outcome.url, httpStatus: outcome.httpStatus, ms: outcome.ms });
        void this.watchAppErrors(outcome.url);
        return { url: outcome.url, httpStatus: outcome.httpStatus };
      case "exited":
        // The stderr rides along for the pod logs and /admin, but the web feed deliberately
        // does NOT render it (lib/events.ts): the agent is about to be handed it to fix, and a
        // stack trace shown to someone watching a demo makes Orin look broken, not the app.
        this.log("preview_server_exited", {
          port, url: outcome.url, exitCode: outcome.exitCode, stderr: outcome.stderr, ms: outcome.ms,
        });
        return { url: outcome.url, httpStatus: "server-exited" };
      case "unreachable":
        this.log("preview_unreachable", { port, url: outcome.url, httpStatus: outcome.httpStatus, ms: outcome.ms });
        return { url: outcome.url, httpStatus: outcome.httpStatus };
    }
  }


  // Subscribe to the app's compile errors. Best-effort by design: `connectHmr` returns null on
  // anything unexpected (Vite moved the token, socket refused), and a build without the watcher
  // is exactly what we shipped before it existed.
  private async watchAppErrors(url: string) {
    this.hmr?.close();
    this.hmr = await connectHmr(url, {
      // NOT rendered as an error in the web feed — the agent gets the message, the user gets
      // "fixing". Same rule as a dead dev server.
      onError: (e) => this.log("preview_error", { message: e.message, id: e.id, plugin: e.plugin }),
    });
    if (!this.hmr) this.log("preview_watch_unavailable", { url });
  }

  // The common case the dev-server exit path can't see: Vite stays up, serves 200 at `/`, and
  // shows its overlay for a module that won't compile. Round boundary only, same as the other.
  private async repairAppError(iteration: number): Promise<boolean> {
    if (this.closed) return false;
    const hmr = this.hmr;
    if (!hmr?.error) return false;

    // Ask before acting. Vite sends nothing when code starts compiling again, and the agent has
    // very likely already fixed this in the round we're closing — re-reporting a stale error
    // would send it chasing a bug that no longer exists.
    // Ask before acting, then let the policy (repairPolicy.ts) decide — it owns the counting.
    const stillBroken = await hmr.revalidate();
    const err = hmr.error;
    const decision = nextRepair(this.repair, stillBroken && err ? err.message : null);
    this.repair = decision.state;

    if (decision.kind === "recovered") {
      this.log("preview_recovered", { iteration });
      return false;
    }
    if (!err) return false;
    if (decision.kind === "giveup") {
      this.log("preview_failed", { iteration, message: err.message, id: err.id });
      return false;
    }

    if (decision.report) {
      const where = moduleUrlPath(err.id);
      this.context.push({
        role: "user",
        content:
          `The app does not compile, so the preview is showing an error instead of your app` +
          `${where ? ` — the failing module is ${where}` : ""}. Fix it, then stop and say what you fixed. ` +
          `Vite reported:\n\n${err.message}`,
      });
    }
    const isNew = decision.report;
    this.log("preview_repairing", { iteration, id: err.id, message: err.message, reported: isNew, repairsLeft: this.repair.repairsLeft });
    return true;
  }

  // Called ONLY at a round boundary (the assistant's tool_calls and their results are both
  // already in context), because that's the only place it's protocol-valid to append.
  //
  // If the app's dev server has died, the fix belongs to the agent, not the user: it wrote
  // the code that broke, and it's the only party that can repair it. So the stderr goes into
  // the agent's context as a plain user-role message and the server is restarted. Someone
  // watching the build sees "fixing the preview", not a stack trace.
  //
  // Note what this branch is and isn't. `bun run dev` is `vite` — there's no build step in dev
  // (the template's `build` script, `tsc -b && vite build`, is never run here), and Vite
  // transforms modules per request. A syntax error in a component does NOT kill the process;
  // Vite keeps serving and shows its HMR overlay in the iframe. So a process exit means the
  // server itself failed: a bad vite.config.ts, a dependency that won't load, the port taken,
  // or OOM. The overlay class is a separate problem (future-considerations "mask build errors").
  //
  // Returns true if a repair was handed over — the caller keeps the loop running so the
  // agent actually gets a turn to act on it.
  private async repairDevServer(iteration: number): Promise<boolean> {
    // A closing session kills the sandbox, which exits the dev server too — that's a
    // teardown, not a crash. Without this the last round of a disconnecting session would
    // inject a bogus repair and try to restart a preview inside a dead sandbox.
    if (this.closed) return false;
    const handle = this.devServer;
    if (!handle || handle.exitCode === undefined) return false; // no server yet, or still alive

    const stderr = (handle.stderr ?? "").trim().slice(-DEV_SERVER_STDERR_CHARS);
    this.devServer = undefined; // consumed — don't report the same corpse twice

    if (this.repair.repairsLeft <= 0) {
      // Out of attempts. Now it IS the user's problem, so say so in plain words — still no
      // stack trace, but never an indefinite "working on it".
      this.log("preview_failed", { iteration, exitCode: handle.exitCode, stderr });
      return false;
    }
    this.repair = { ...this.repair, repairsLeft: this.repair.repairsLeft - 1 };

    this.context.push({
      role: "user",
      content:
        `The Vite dev server serving the preview exited (code ${handle.exitCode}), so the preview is down. ` +
        `This is the server process failing to start or stay up — look for a bad vite.config.ts, a dependency ` +
        `that fails to load, or a file that throws when imported. Fix the cause, then stop and say what you fixed. ` +
        `Its output was:\n\n${stderr}`,
    });
    this.log("preview_repairing", { iteration, exitCode: handle.exitCode, stderr, repairsLeft: this.repair.repairsLeft });

    // Restart in the background: the agent edits while the server comes back up, exactly as
    // on a normal build. If it dies again, the next round boundary catches it.
    void this.startPreview(this.previewPort).catch(() => {});
    return true;
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

      // Reserve this step before spending it (7a). A refusal ends the run with a saved note;
      // a budget-store failure ends it too — fail closed, never call the LLM unmetered.
      if (this.stepBudget) {
        const budget = await this.stepBudget.reserve().catch((e) => {
          this.log("budget_error", { iteration: start, message: String(e) });
          return null;
        });
        if (!budget) break;
        if (!budget.ok) {
          const note = BUDGET_NOTES[budget.reason];
          this.context.push({ role: "assistant", content: note });
          this.log("budget_exhausted", { iteration: start, reason: budget.reason, content: note });
          const snap = await this.snapshot();
          await this.flush();
          await this.enqueueRound(snap);
          return;
        }
      }

      const llmStart = performance.now();
      const response = await this.llmProvider.callLLM(this.context, tools);
      const llmDurationMs = Math.round(performance.now() - llmStart);
      // The provider failed us — don't charge the user a step for it.
      if (this.stepBudget && (response.status === "error" || response.status === "exception")) {
        await this.stepBudget.refund().catch((e) => this.log("budget_error", { iteration: start, message: String(e) }));
      }
      if (this.closed) break; // closed while the LLM was thinking — don't run tools on a dead sandbox

      this.log("llm_call", { iteration: start, status: response.status, durationMs: llmDurationMs, usage: response.usage })

      if (response.status === "done") {

        this.context.push({ role: "assistant", content: response.content });
        this.log("final", { iteration: start, content: response.content });
        // "Done" and "it runs" are different claims. If the dev server died or the app won't
        // compile, keep going — an agent that stops with a broken app hasn't finished the job.
        const repaired = (await this.repairDevServer(start)) || (await this.repairAppError(start));
        const snap = await this.snapshot();
        await this.flush();
        await this.enqueueRound(snap);
        if (repaired) { start++; continue; }
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
          tools: response.content.toolCalls.map((t, i) => ({
            name: t.name,
            ok: toolResponse[i].ok,
            command: commandLine(t.argument?.command),
          })),
        })

        // Round complete (assistant tool_calls + tool results both appended). Snapshot
        // the files this round wrote, persist the context rows, then hand the round to the
        // snapshot queue (the worker pushes to R2 and advances the durable-N marker).
        // A crash or compile error is appended first, so it flushes with this round. Exclusive:
        // if the server is being restarted there's no live Vite to have an opinion about the code.
        if (!(await this.repairDevServer(start))) await this.repairAppError(start);
        const snap = await this.snapshot();
        await this.flush();
        await this.enqueueRound(snap);

      } else if (response.status === "error") {
        this.log("error", { iteration: start, content: response.content });
        break;
      } else {
        this.log("exception", { iteration: start, content: response.content });
        break;
      }

      start++
    }

    if (start > end && !this.closed) {
      // Hitting the step limit used to be near-silent: one muted telemetry line, and the
      // preview bar said "live" as if the build had finished. Close the run with a real,
      // persisted message instead — visible live, correct after a reopen, and when the
      // user says "continue" the model can see in its own history why it stopped. A
      // plain-string assistant message is protocol-valid after a tool result (it's the
      // same shape as a final answer). The web recognises this wording (lib/events.ts).
      const note = `I hit the ${end}-step limit before finishing. Say "continue" and I'll pick up where I left off.`;
      this.context.push({ role: "assistant", content: note });
      this.log("max_iterations_reached", { iteration: start, content: note });
      const snap = await this.snapshot();
      await this.flush();
      await this.enqueueRound(snap);
    }
  }
}
