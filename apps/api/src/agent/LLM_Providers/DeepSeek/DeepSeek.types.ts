import {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
  CompletionUsage,
} from "openai/resources";

type DeepSeekAssistantMessage =
  ChatCompletionAssistantMessageParam & {
    reasoning_content: string;
  };

export type DeepSeekMessage =
  | ChatCompletionMessageParam
  | DeepSeekAssistantMessage;

export type DeepSeekUsage = CompletionUsage & {
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
};

