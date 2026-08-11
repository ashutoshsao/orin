import {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
} from "openai/resources";

type DeepSeekAssistantMessage =
  ChatCompletionAssistantMessageParam & {
    reasoning_content: string;
  };

export type DeepSeekMessage =
  | ChatCompletionMessageParam
  | DeepSeekAssistantMessage;

