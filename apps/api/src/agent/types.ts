import z from "zod";

const role = z.enum(["system", "user", "assistant", "tool"]);
const effort = z.enum(["high", "medium", "low"]);

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: object;
      properties: Record<string,
        {
          type: string;
          description: string;
        }>;
      required: string[];
      additionalProperties: boolean;
    };
  };
  strict: boolean;
};


//requested tool call type
export type ToolCall = {
  id: string,
  name: string,
  argument: Record<string, string>
}

export type ToolCallsType = {
  content: string,
  reasoningContent: string,
  toolCalls: ToolCall[]
}

//tool result type

export type ToolResultType = {
  id: string,
  content: string,
  ok: boolean
}

export type UsageType = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens?: number
  cacheMissTokens?: number
}

export type LLMResponseType =
  {
    status: "done" | "error" | "exception"
    content: string
    usage?: UsageType
  } |
  {
    status: "toolCall"
    content: ToolCallsType
    usage?: UsageType
  }

export type MessageType = {
  role: "user" | "system"
  content: string
} |
{
  role: "assistant",
  content: string | ToolCallsType
} |
{
  role: "tool",
  content: ToolResultType[]
}

export type ContextType = MessageType[];

export type LLMProvider = {
  callLLM: (context: ContextType, tools: ToolDefinition[]) => Promise<LLMResponseType>
}

export type EffortType = z.infer<typeof effort>
export type RoleType = z.infer<typeof role>
