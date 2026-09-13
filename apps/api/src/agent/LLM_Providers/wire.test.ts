import { describe, expect, test } from "bun:test";
import { ClaudeProvider } from "./claude";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import { tools } from "../tools";
import type { ContextType } from "../types";

// What actually goes on the wire, and what comes back — with a stubbed transport, so no
// network and no keys. Mirrors the two protocols: Chat Completions and Messages.
const CONTEXT: ContextType = [
  { role: "system", content: "You are Orin." },
  { role: "user", content: "list the files" },
];

function stub(body: unknown, status = 200) {
  const calls: { url: string; body: any }[] = [];
  const fetchStub = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetchStub };
}

describe("OpenAI-compatible adapter", () => {
  const chat = (choice: unknown, usage?: unknown) => ({
    id: "c1", object: "chat.completion", created: 0, model: "m",
    choices: [choice], ...(usage ? { usage } : {}),
  });

  test("sends model, messages and tools to the configured base URL", async () => {
    const { calls, fetchStub } = stub(chat({ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }));
    const provider = new OpenAICompatibleProvider({ baseURL: "https://api.deepseek.com", apiKey: "k", model: "deepseek-v4-flash", effort: "low", fetch: fetchStub });
    await provider.callLLM(CONTEXT, tools);

    expect(calls[0].url).toBe("https://api.deepseek.com/chat/completions");
    expect(calls[0].body).toMatchObject({ model: "deepseek-v4-flash", reasoning_effort: "low", stream: false });
    expect(calls[0].body.messages).toHaveLength(2);
    expect(calls[0].body.tools.map((t: any) => t.function.name)).toContain("bash_tool");
  });

  test("a finished answer becomes status done, with usage", async () => {
    const { fetchStub } = stub(
      chat({ index: 0, finish_reason: "stop", message: { role: "assistant", content: "all set" } },
        { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, prompt_cache_hit_tokens: 8 }),
    );
    const res = await new OpenAICompatibleProvider({ baseURL: "https://x", apiKey: "k", model: "m", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res).toMatchObject({ status: "done", content: "all set" });
    expect(res.usage).toMatchObject({ promptTokens: 10, totalTokens: 13, cacheHitTokens: 8 });
  });

  test("tool calls are parsed out of the JSON-string arguments", async () => {
    const { fetchStub } = stub(chat({
      index: 0, finish_reason: "tool_calls",
      message: {
        role: "assistant", content: "", reasoning_content: "thinking",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "bash_tool", arguments: '{"command":"ls -a"}' } }],
      },
    }));
    const res = await new OpenAICompatibleProvider({ baseURL: "https://x", apiKey: "k", model: "m", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res.status).toBe("toolCall");
    if (res.status !== "toolCall") return;
    expect(res.content.toolCalls[0]).toEqual({ id: "call_1", name: "bash_tool", argument: { command: "ls -a" } });
    expect(res.content.reasoningContent).toBe("thinking");
  });

  test("an HTTP failure is an error result, not a thrown exception", async () => {
    const { fetchStub } = stub({ error: { message: "rate limited" } }, 429);
    const res = await new OpenAICompatibleProvider({ baseURL: "https://x", apiKey: "k", model: "m", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res.status).toBe("error");
  });

  test("hitting the output cap is reported, not returned as an answer", async () => {
    const { fetchStub } = stub(chat({ index: 0, finish_reason: "length", message: { role: "assistant", content: "half a th" } }));
    const res = await new OpenAICompatibleProvider({ baseURL: "https://x", apiKey: "k", model: "m", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res).toMatchObject({ status: "exception" });
  });
});

describe("Claude adapter", () => {
  const message = (content: unknown[], stop_reason: string, extra: Record<string, unknown> = {}) => ({
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5",
    content, stop_reason, stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 9 },
    ...extra,
  });

  test("sends a top-level system prompt and input_schema tools", async () => {
    const { calls, fetchStub } = stub(message([{ type: "text", text: "hi" }], "end_turn"));
    await new ClaudeProvider({ apiKey: "k", model: "claude-opus-5", effort: "high", fetch: fetchStub }).callLLM(CONTEXT, tools);

    expect(calls[0].url).toContain("/v1/messages");
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5", system: "You are Orin.", output_config: { effort: "high" } });
    expect(calls[0].body.messages).toEqual([{ role: "user", content: "list the files" }]); // system is not a turn
    expect(calls[0].body.tools[0]).toMatchObject({ name: "bash_tool", strict: true });
    expect(calls[0].body.tools[0].input_schema.type).toBe("object");
  });

  test("tool_use blocks become tool calls; thinking is kept for the next turn", async () => {
    const thinking = { type: "thinking", thinking: "look first", signature: "sig" };
    const { fetchStub } = stub(message([
      thinking,
      { type: "text", text: "Listing files." },
      { type: "tool_use", id: "toolu_1", name: "bash_tool", input: { command: "ls" } },
    ], "tool_use"));
    const res = await new ClaudeProvider({ apiKey: "k", fetch: fetchStub }).callLLM(CONTEXT, tools);

    expect(res.status).toBe("toolCall");
    if (res.status !== "toolCall") return;
    expect(res.content.toolCalls[0]).toEqual({ id: "toolu_1", name: "bash_tool", argument: { command: "ls" } });
    expect(res.content.content).toBe("Listing files.");
    expect(JSON.parse(res.content.reasoningContent)).toEqual([thinking]);
    expect(res.usage).toMatchObject({ promptTokens: 12, completionTokens: 4, totalTokens: 16, cacheHitTokens: 9 });
  });

  test("a plain answer joins its text blocks", async () => {
    const { fetchStub } = stub(message([{ type: "text", text: "all " }, { type: "text", text: "done" }], "end_turn"));
    const res = await new ClaudeProvider({ apiKey: "k", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res).toMatchObject({ status: "done", content: "all done" });
  });

  test("a refusal is an error with its reason, not an empty answer", async () => {
    const { fetchStub } = stub(message([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "declined" } }));
    const res = await new ClaudeProvider({ apiKey: "k", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res.status).toBe("error");
    expect(res.content).toContain("declined");
  });

  test("hitting the output cap is reported", async () => {
    const { fetchStub } = stub(message([{ type: "text", text: "half a th" }], "max_tokens"));
    const res = await new ClaudeProvider({ apiKey: "k", fetch: fetchStub }).callLLM(CONTEXT, tools);
    expect(res.status).toBe("exception");
  });
});
