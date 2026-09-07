import { Sandbox } from "e2b";
import { ContextType, LLMProvider } from "./types";
import { toolExecution, tools, WORKDIR } from "./tools";
import { config } from "./config";

const TEMPLATE = "orin-react-workspace-dev";
// agent is never cut off mid-build. This is only a safety ceiling — `close()` in
// the `finally` kills the sandbox as soon as a run finishes normally.
const SANDBOX_TIMEOUT_MS = 60 * 60_000;

export class AgentSession {
  private context: ContextType;
  private sessionId: string;

  // Private: the only way to get a session is via `create`, which guarantees the
  // sandbox is already booted — so `sandbox` is never null and never half-ready.
  private constructor(private llmProvider: LLMProvider, private sandbox: Sandbox) {
    this.sessionId = crypto.randomUUID();
    this.context = [
      { role: "system", content: "You are a helpful assistant, also you are provided with tools you can provide with commands that can be execute" },
    ];
  }

  // Async construction: `await Sandbox.create(...)` can't live in a constructor,
  // so it lives here and the session isn't returned until the sandbox is live.
  static async create(llmProvider: LLMProvider) {
    const sandbox = await Sandbox.create(TEMPLATE, { timeoutMs: SANDBOX_TIMEOUT_MS });
    const session = new AgentSession(llmProvider, sandbox);
    session.log("sandbox_created", { sandboxId: sandbox.sandboxId, template: TEMPLATE });
    return session;
  }

  // Sandboxes are live VMs on E2B's infra — kill it when the session is done.
  async close() {
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

  private log(event: string, data: Record<string, unknown> = {}) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), sessionId: this.sessionId, event, ...data }));
  }

  async run(userPrompt: string) {
    this.context.push({
      role: "user", content: userPrompt
    })

    this.log("run_start", { userPrompt })

    let start = parseInt(config.initIteration)
    let end = parseInt(config.maxIteration)

    while (start <= end) {

      const llmStart = performance.now();
      const response = await this.llmProvider.callLLM(this.context, tools);
      const llmDurationMs = Math.round(performance.now() - llmStart);

      this.log("llm_call", { iteration: start, status: response.status, durationMs: llmDurationMs, usage: response.usage })

      if (response.status === "done") {

        this.context.push({ role: "assistant", content: response.content });
        this.log("final", { iteration: start, content: response.content });
        break;

      } else if (response.status === "toolCall") {

        this.context.push({
          role: "assistant", content: response.content
        })

        const toolStart = performance.now();
        const toolResponse = await toolExecution(response.content.toolCalls, this.sandbox)
        const toolDurationMs = Math.round(performance.now() - toolStart);

        this.context.push({
          role: "tool", content: toolResponse
        })

        this.log("tool_call", {
          iteration: start,
          durationMs: toolDurationMs,
          tools: response.content.toolCalls.map((t, i) => ({ name: t.name, ok: toolResponse[i].ok }))
        })

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
