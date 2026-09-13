import Anthropic from "@anthropic-ai/sdk";
import type { ContextType, LLMResponseType, ToolCall, ToolDefinition, UsageType } from "../types";

// Claude adapter (7e). The Messages API is a different protocol from Chat Completions, not
// a dialect of it: the system prompt is a top-level field, tool calls are `tool_use` content
// blocks, tool results are `tool_result` blocks inside a USER message, and the model's
// reasoning comes back as `thinking` blocks that must be echoed back verbatim on the turn
// after a tool call (same rule DeepSeek has for `reasoning_content`).
//
// Orin's context carries one string for reasoning, so the thinking blocks are stored in it
// as JSON and rebuilt here. That keeps the provider's shapes inside the provider — the agent
// loop only ever sees LLMResponseType.

// Thinking is on by default on Opus 5; `max_tokens` is the non-streaming default from the
// Claude API guidance (a low cap truncates a build mid-thought).
const MAX_TOKENS = 16_000;
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5";

export type ClaudeConfig = {
  apiKey: string;
  model?: string;
  // low | medium | high | xhigh | max — thinking depth and token spend.
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  // Test seam: swap the transport to assert what goes on the wire without a live call.
  fetch?: typeof fetch;
};

export class ClaudeProvider {
  private client: Anthropic;
  private model: string;

  constructor(private config: ClaudeConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey, fetch: config.fetch });
    this.model = config.model ?? DEFAULT_CLAUDE_MODEL;
  }

  async callLLM(context: ContextType, tools: ToolDefinition[]): Promise<LLMResponseType> {
    try {
      const { system, messages } = translateMessages(context);
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        ...(system ? { system } : {}),
        ...(this.config.effort ? { output_config: { effort: this.config.effort } } : {}),
        tools: translateTools(tools),
        messages,
      });

      const usage: UsageType = {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        cacheHitTokens: response.usage.cache_read_input_tokens ?? undefined,
        cacheMissTokens: response.usage.cache_creation_input_tokens ?? undefined,
      };

      // A refusal is a normal 200 with stop_reason "refusal" — check it before reading content.
      if (response.stop_reason === "refusal") {
        return { status: "error", content: `refused: ${response.stop_details?.explanation ?? "no reason given"}` };
      }
      if (response.stop_reason === "max_tokens") {
        return { status: "exception", content: "the model hit its output length limit" };
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length > 0) {
        const toolCalls: ToolCall[] = toolUses.map((block) => ({
          id: block.id,
          name: block.name,
          argument: block.input as Record<string, string>,
        }));
        // Keep the thinking blocks so they can be replayed verbatim next turn.
        const thinking = response.content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking");
        return {
          status: "toolCall",
          content: { toolCalls, content: text, reasoningContent: thinking.length ? JSON.stringify(thinking) : "" },
          usage,
        };
      }
      return { status: "done", content: text, usage };
    } catch (error) {
      return { status: "error", content: (error as Error).message };
    }
  }
}

// Orin's context → a top-level system prompt plus Messages-API turns.
export function translateMessages(context: ContextType): { system?: string; messages: Anthropic.MessageParam[] } {
  let system: string | undefined;
  const messages: Anthropic.MessageParam[] = [];

  for (const msg of context) {
    switch (msg.role) {
      case "system":
        // Claude takes the system prompt as its own field, not as a turn.
        system = system ? `${system}\n\n${msg.content}` : msg.content;
        break;
      case "user":
        messages.push({ role: "user", content: msg.content });
        break;
      case "assistant": {
        if (typeof msg.content === "string") {
          messages.push({ role: "assistant", content: msg.content });
          break;
        }
        const blocks: Anthropic.ContentBlockParam[] = [];
        // Thinking blocks first and unchanged — the API rejects edited ones.
        for (const block of parseThinking(msg.content.reasoningContent)) blocks.push(block);
        if (msg.content.content) blocks.push({ type: "text", text: msg.content.content });
        for (const call of msg.content.toolCalls) {
          blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.argument });
        }
        messages.push({ role: "assistant", content: blocks });
        break;
      }
      case "tool":
        // Every result for a turn goes in ONE user message — splitting them teaches the
        // model to stop making parallel calls.
        messages.push({
          role: "user",
          content: msg.content.map((result) => ({
            type: "tool_result" as const,
            tool_use_id: result.id,
            content: result.content,
            ...(result.ok ? {} : { is_error: true }),
          })),
        });
        break;
    }
  }
  return { system, messages };
}

// `reasoningContent` holds Claude thinking blocks as JSON (see the file header). Anything
// else — an empty string, or a trace from another provider after a model switch — is dropped.
function parseThinking(raw: string): Anthropic.ContentBlockParam[] {
  if (!raw.startsWith("[")) return [];
  try {
    const blocks = JSON.parse(raw);
    return Array.isArray(blocks) ? (blocks as Anthropic.ContentBlockParam[]) : [];
  } catch {
    return [];
  }
}

export function translateTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
    // Guarantees the arguments validate against the schema (the schemas already set
    // `required` and `additionalProperties: false`).
    strict: true,
  }));
}
