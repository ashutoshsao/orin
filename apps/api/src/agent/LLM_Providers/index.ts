import type { EffortType, LLMProvider } from "../types";
import { ClaudeProvider, DEFAULT_CLAUDE_MODEL } from "./claude";
import { OpenAICompatibleProvider } from "./openaiCompatible";

// Where a session's model comes from (7e). Everything except Claude speaks the
// OpenAI-compatible Chat Completions API, so they differ only by base URL and defaults.
// A BYOK visitor picks one of these and supplies the key (7f); server-keyed sessions use
// the env key for the same provider.

export const PROVIDERS = {
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-v4.1-flash-expires-on-0910",
    envKey: "DEEPSEEK_API_KEY",
    // DeepSeek 400s unless its reasoning trace is echoed back after a tool call.
    echoReasoning: true,
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    defaultModel: null, // no guessed default: set ORIN_MODEL / pick one in the BYOK form
    envKey: "OPENAI_API_KEY",
    echoReasoning: false,
  },
  gemini: {
    label: "Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: null, // as above — model ids move faster than this file
    envKey: "GEMINI_API_KEY",
    echoReasoning: false,
  },
  anthropic: {
    label: "Claude",
    baseURL: null, // its own SDK and protocol
    defaultModel: DEFAULT_CLAUDE_MODEL,
    envKey: "ANTHROPIC_API_KEY",
    echoReasoning: false,
  },
} as const;

export type ProviderId = keyof typeof PROVIDERS;
export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
export const isProviderId = (value: string): value is ProviderId => value in PROVIDERS;

export type ProviderChoice = {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  effort?: EffortType;
};

// Build the provider a session will use. The key is passed in, never read from env here:
// a BYOK session's key lives only in memory, and the caller decides which key applies.
export function createProvider({ provider, apiKey, model, effort }: ProviderChoice): LLMProvider {
  const spec = PROVIDERS[provider];
  const chosen = model ?? spec.defaultModel;
  if (!chosen) throw new Error(`a model name is required for ${spec.label} (it has no default here)`);
  if (provider === "anthropic") return new ClaudeProvider({ apiKey, model: chosen, effort });
  return new OpenAICompatibleProvider({
    baseURL: spec.baseURL!,
    apiKey,
    model: chosen,
    effort,
    echoReasoning: spec.echoReasoning,
  });
}

// The provider a server-keyed session uses: `ORIN_PROVIDER` if set, else DeepSeek, with the
// key from that provider's env var. Throws loudly at startup rather than mid-build.
export function serverProvider(effort: EffortType = "low"): LLMProvider {
  const id = process.env.ORIN_PROVIDER ?? "deepseek";
  if (!isProviderId(id)) throw new Error(`ORIN_PROVIDER must be one of ${PROVIDER_IDS.join(", ")} (got ${id})`);
  const apiKey = process.env[PROVIDERS[id].envKey];
  if (!apiKey) throw new Error(`${PROVIDERS[id].envKey} is not set (needed for the ${PROVIDERS[id].label} provider)`);
  return createProvider({ provider: id, apiKey, model: process.env.ORIN_MODEL, effort });
}
