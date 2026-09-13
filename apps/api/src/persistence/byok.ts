import type { LLMProvider } from "../agent/types";
import { createProvider, type ProviderId } from "../agent/LLM_Providers";

// A visitor's own API key (7f). It lives HERE and nowhere else: never in Postgres, never in
// a log line, never in an SSE event, and never inside the sandbox (the agent runs shell
// commands an untrusted model wrote — a key in that environment is a key you've given away).
// The consequence is that a key doesn't survive a server restart, which is why the UI asks
// again when it's gone.

export type ByokKey = { provider: ProviderId; apiKey: string; model?: string };

const keys = new Map<string, ByokKey>(); // by userId

export function setKey(userId: string, key: ByokKey): void {
  keys.set(userId, key);
}

export function hasKey(userId: string): boolean {
  return keys.has(userId);
}

// Only the agent session may read it, and only to build a provider — nothing else takes the
// raw value, so it can't be logged or persisted by accident.
export function providerForUser(userId: string, effort: "low" | "medium" | "high" = "low"): LLMProvider | null {
  const key = keys.get(userId);
  return key ? createProvider({ provider: key.provider, apiKey: key.apiKey, model: key.model, effort }) : null;
}

// Which provider they chose (safe to show); never exposes the key itself.
export function keyInfo(userId: string): { provider: ProviderId; model?: string } | null {
  const key = keys.get(userId);
  return key ? { provider: key.provider, model: key.model } : null;
}

export function clearKey(userId: string): void {
  keys.delete(userId);
}

// Prove the key works before accepting it, so a typo fails at the form instead of halfway
// through a build. A tiny no-tools call: cheapest thing that exercises auth end to end.
export async function validateKey(
  key: ByokKey,
  build: (k: ByokKey) => LLMProvider = (k) => createProvider({ provider: k.provider, apiKey: k.apiKey, model: k.model }),
): Promise<{ ok: true } | { ok: false; message: string }> {
  let provider: LLMProvider;
  try {
    provider = build(key);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "That provider needs a model name." };
  }
  const res = await provider.callLLM([{ role: "user", content: "Reply with: ok" }], []);
  if (res.status === "error") {
    // Surface the provider's own wording (wrong key, no credit, unknown model), never the key.
    return { ok: false, message: typeof res.content === "string" ? res.content : "That key was rejected." };
  }
  return { ok: true };
}
