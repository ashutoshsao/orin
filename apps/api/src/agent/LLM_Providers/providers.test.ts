import { describe, expect, test } from "bun:test";
import { translateMessages as toChatMessages, translateTools as toChatTools } from "./openaiCompatible";
import { translateMessages as toClaudeMessages, translateTools as toClaudeTools } from "./claude";
import { createProvider, isProviderId, PROVIDER_IDS } from "./index";
import { tools } from "../tools";
import type { ContextType } from "../types";

// A round with every message shape the loop produces: system, user, an assistant turn that
// called a tool (with a reasoning trace), and the tool's result.
const CONTEXT: ContextType = [
  { role: "system", content: "You are Orin." },
  { role: "user", content: "build a todo app" },
  {
    role: "assistant",
    content: {
      content: "Listing the files first.",
      reasoningContent: "let me look around",
      toolCalls: [{ id: "call_1", name: "bash_tool", argument: { command: "ls" } }],
    },
  },
  { role: "tool", content: [{ id: "call_1", content: "src\nindex.html", ok: true }] },
];

describe("OpenAI-compatible translation", () => {
  test("keeps tool calls next to their results, one message per result", () => {
    const msgs = toChatMessages(CONTEXT, true);
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    const assistant = msgs[2] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    expect(assistant.tool_calls[0]).toMatchObject({ id: "call_1", function: { name: "bash_tool", arguments: '{"command":"ls"}' } });
    expect(msgs[3]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "src\nindex.html" });
  });

  test("reasoning is echoed only for providers that require it (DeepSeek 400s without it)", () => {
    expect(toChatMessages(CONTEXT, true)[2]).toHaveProperty("reasoning_content", "let me look around");
    expect(toChatMessages(CONTEXT, false)[2]).not.toHaveProperty("reasoning_content");
  });

  test("tools keep their function schema", () => {
    const translated = toChatTools(tools);
    expect(translated[0]).toMatchObject({ type: "function", function: { name: "bash_tool" } });
    expect(translated[0].function.parameters.required).toContain("command");
  });
});

describe("Claude translation", () => {
  test("system prompt is lifted out of the turns", () => {
    const { system, messages } = toClaudeMessages(CONTEXT);
    expect(system).toBe("You are Orin.");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]); // tool results ride in a user turn
  });

  test("tool calls become tool_use blocks; results become tool_result blocks", () => {
    const { messages } = toClaudeMessages(CONTEXT);
    const assistant = messages[1].content as { type: string; id?: string; name?: string }[];
    expect(assistant.find((b) => b.type === "tool_use")).toMatchObject({ id: "call_1", name: "bash_tool" });
    const result = (messages[2].content as { type: string; tool_use_id: string; content: string }[])[0];
    expect(result).toMatchObject({ type: "tool_result", tool_use_id: "call_1", content: "src\nindex.html" });
  });

  test("a failed tool result is marked is_error", () => {
    const failed: ContextType = [{ role: "tool", content: [{ id: "call_1", content: "boom", ok: false }] }];
    const block = (toClaudeMessages(failed).messages[0].content as { is_error?: boolean }[])[0];
    expect(block.is_error).toBe(true);
  });

  test("thinking blocks round-trip verbatim; a foreign trace is dropped", () => {
    const thinking = [{ type: "thinking", thinking: "hmm", signature: "sig-abc" }];
    const withThinking: ContextType = [
      { role: "assistant", content: { content: "ok", reasoningContent: JSON.stringify(thinking), toolCalls: [] } },
      { role: "assistant", content: { content: "ok", reasoningContent: "a DeepSeek trace, not JSON", toolCalls: [] } },
    ];
    const { messages } = toClaudeMessages(withThinking);
    expect((messages[0].content as unknown[])[0]).toEqual(thinking[0]);
    expect((messages[1].content as { type: string }[]).some((b) => b.type === "thinking")).toBe(false);
  });

  test("tools become input_schema with strict validation", () => {
    const translated = toClaudeTools(tools);
    expect(translated[0]).toMatchObject({ name: "bash_tool", strict: true });
    expect(translated[0].input_schema).toMatchObject({ type: "object" });
  });
});

describe("provider registry", () => {
  test("every id builds a provider", () => {
    for (const id of PROVIDER_IDS) {
      expect(createProvider({ provider: id, apiKey: "test-key", model: "some-model" })).toHaveProperty("callLLM");
    }
  });

  test("providers without a default model say so instead of guessing one", () => {
    expect(() => createProvider({ provider: "openai", apiKey: "k" })).toThrow("model name is required");
    expect(createProvider({ provider: "deepseek", apiKey: "k" })).toHaveProperty("callLLM");
  });

  test("unknown provider ids are rejected", () => {
    expect(isProviderId("deepseek")).toBe(true);
    expect(isProviderId("mistral")).toBe(false);
  });
});
