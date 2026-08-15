import { ContextType, LLMProvider } from "./types";
import { toolExecution, tools } from "./tools";
import { config } from "./config";

export class AgentSession {
  private context: ContextType;
  private sessionId: string;

  constructor(private llmProvider: LLMProvider, private cwd: string) {
    this.sessionId = crypto.randomUUID();
    this.context = [
      { role: "system", content: "You are a helpful assistant, also you are provided with tools you can provide with commands that can be execute" },
    ];
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
        const toolResponse = await toolExecution(response.content.toolCalls, this.cwd)
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
