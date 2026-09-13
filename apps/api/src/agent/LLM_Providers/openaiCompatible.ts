import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  CompletionUsage,
} from "openai/resources";
import type { ContextType, EffortType, LLMResponseType, ToolCall, ToolDefinition, UsageType } from "../types";

// One adapter for every OpenAI-compatible Chat Completions API (7e): DeepSeek, OpenAI,
// Gemini's compat endpoint, MiniMax… They differ only by base URL, model name and a few
// optional fields, so the translation lives here once. Claude speaks a different protocol
// and has its own adapter (claude.ts).
//
// Provider-specific shapes (`choices[0]`, `finish_reason`, `tool_calls`, `reasoning_content`)
// never leave this file — the agent loop only sees LLMResponseType.

// DeepSeek returns its own reasoning trace and cache counters on the standard shapes.
type ReasoningAssistantMessage = ChatCompletionAssistantMessageParam & { reasoning_content?: string };
type CompatMessage = ChatCompletionMessageParam | ReasoningAssistantMessage;
type CompatUsage = CompletionUsage & { prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number };

export type OpenAICompatibleConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
  // Sent as `reasoning_effort`. Omitted for endpoints that reject it.
  effort?: EffortType;
  // DeepSeek 400s unless `reasoning_content` is echoed back on the turn after a tool call;
  // other providers reject the unknown field, so it's opt-in per provider.
  echoReasoning?: boolean;
  // Test seam: swap the transport to assert what goes on the wire without a live call.
  fetch?: typeof fetch;
};

export class OpenAICompatibleProvider {
  private client: OpenAI;

  constructor(private config: OpenAICompatibleConfig) {
    this.client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey, fetch: config.fetch });
  }

  async callLLM(context: ContextType, tools: ToolDefinition[]): Promise<LLMResponseType> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        ...(this.config.effort ? { reasoning_effort: this.config.effort } : {}),
        messages: translateMessages(context, this.config.echoReasoning ?? false) as ChatCompletionMessageParam[],
        tools: translateTools(tools),
        stream: false,
      });

      const choice = response.choices[0];
      const usage = translateUsage(response.usage as CompatUsage | undefined);

      if (choice.finish_reason === "tool_calls") {
        const calls = choice.message.tool_calls ?? [];
        const toolCalls: ToolCall[] = [];
        for (const call of calls) {
          // `arguments` is a JSON-encoded string, and a model can emit malformed JSON —
          // a parse failure is an error for this round, not a crashed session.
          const fn = (call as { function: { name: string; arguments: string } }).function;
          toolCalls.push({ id: call.id, name: fn.name, argument: JSON.parse(fn.arguments) });
        }
        return {
          status: "toolCall",
          content: {
            toolCalls,
            content: choice.message.content ?? "",
            reasoningContent: (choice.message as { reasoning_content?: string }).reasoning_content ?? "",
          },
          usage,
        };
      }
      if (choice.finish_reason === "stop") return { status: "done", content: choice.message.content ?? "", usage };
      if (choice.finish_reason === "length") {
        return { status: "exception", content: "the model hit its output length limit" };
      }
      return { status: "exception", content: `unexpected finish_reason: ${choice.finish_reason}` };
    } catch (error) {
      return { status: "error", content: (error as Error).message };
    }
  }
}

function translateUsage(raw: CompatUsage | undefined): UsageType | undefined {
  if (!raw) return undefined;
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
    cacheHitTokens: raw.prompt_cache_hit_tokens,
    cacheMissTokens: raw.prompt_cache_miss_tokens,
  };
}

export function translateMessages(context: ContextType, echoReasoning: boolean): CompatMessage[] {
  return context.flatMap((msg): CompatMessage | CompatMessage[] => {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content };
      case "user":
        return { role: "user", content: msg.content };
      case "assistant": {
        if (typeof msg.content === "string") return { role: "assistant", content: msg.content };
        return {
          role: "assistant",
          content: msg.content.content,
          ...(echoReasoning ? { reasoning_content: msg.content.reasoningContent } : {}),
          tool_calls: msg.content.toolCalls.map((tool) => ({
            id: tool.id,
            type: "function" as const,
            function: { name: tool.name, arguments: JSON.stringify(tool.argument) },
          })),
        };
      }
      case "tool":
        // One message per result: an assistant tool_calls message must be followed by a
        // result for every tool_call_id before the next request (the protocol invariant).
        return msg.content.map((result) => ({ role: "tool" as const, tool_call_id: result.id, content: result.content }));
    }
  });
}

export function translateTools(tools: ToolDefinition[]) {
  return tools.map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
    strict: tool.strict,
  }));
}
