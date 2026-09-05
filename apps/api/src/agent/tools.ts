import { $ } from "bun"
import { ToolCall } from "./types";

export const tools = [
  {
    type: "function",
    function: {
      name: "bash_tool",
      description: "its a bash tool function, you can call to run bash command",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "shell commmand that needs to be executed eg- ls, cat, echo",
          },
        },
        required: ["command"],
        additionalProperties: false,
      }
    },
    strict: true,
  }
]

export async function toolExecution(toolCalls: ToolCall[], cwd: string) {
  const toolResponses: { id: string, content: string }[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    switch (toolCalls[i].name) {
      case "bash_tool": {
        try {
          const { command } = toolCalls[i].argument;
          const response = await $`sh -c ${command}`.cwd(cwd).text();
          toolResponses.push(
            {
              id: toolCalls[i].id,
              content: response
            }
          )
          break;
        } catch (e) {
          toolResponses.push(
            { id: toolCalls[i].id, content: (e as Error).message }
          )
          break;
        }
      }

      default: {
        toolResponses.push(
          {
            id: toolCalls[i].id,
            content: `Invalid tool call, tool ${toolCalls[i].id} not execute`
          }
        )
        break;
      }
    }
  }
  return toolResponses
}
