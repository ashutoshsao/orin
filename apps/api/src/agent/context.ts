import { ToolCallsType, ToolExecutionResponseType } from "./types";

export type messageType = {
  role: "user" | "assistant" | "tool" | "system"
  content: string
} |
{
  role: "assistant",
  content: ToolCallsType
} |
{
  role: "tool",
  content: ToolExecutionResponseType
}

export type contextType = messageType[];

export const context: contextType = [
  { role: "system", content: "You are a helpful assistant, also you are provided with tools you can provide with commands that can be execute" },
]
