import z from "zod";

const role = z.enum(["system", "user", "assistant", "tool"]);
const effort = z.enum(["high", "medium", "low"]);

export type ToolType = {
  index: number,
  id: string,
  name: string,
  argument: string
}

export type ToolCallsType = {
  content: string,
  reasoningContent: string,
  toolCalls: ToolType[]
}

type ToolResultType = {
  id: string,
  content: string
}

type ToolResultsType = ToolResultType[]

export type LLMResponseType =
  {
    status: "done"
    content: string
  } |
  {
    status: "toolCall"
    content: ToolCallsType
  } |
  {
    status: "error"
    content: string
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
  content: ToolResultsType
}

export type ContextType = MessageType[];

export type LLMProvider = {
  callLLM: (context: ContextType, tools: ToolCallsType) => Promise<LLMResponseType>
}

export type EffortType = z.infer<typeof effort>
export type RoleType = z.infer<typeof role>
