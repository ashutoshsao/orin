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

export type ToolExecutionResponseType = {
  id: string,
  content: string
}[]

export type llmResponseType =
  {
    status: "done"
    content: string
  } |
  {
    status: "tool_call"
    content: ToolCallsType
  } |
  {
    status: "error"
    content: string
  }

export type effortType = z.infer<typeof effort>
export type roleType = z.infer<typeof role>
