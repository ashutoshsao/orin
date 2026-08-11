import { $ } from "bun"
import { ToolType } from "../../types";

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

export async function tool_execution(toolCalls: ToolType[]) {
  const toolResponses: { id: string, content: string }[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    switch (toolCalls[1].name) {
      case "bash_tool": {
        const { command } = JSON.parse(toolCalls[i].argument);
        const response = await $`sh -c ${command}`.text();
        toolResponses.push(
          {
            id: toolCalls[i].id,
            content: response
          }
        )
      }

      default: {
        toolResponses.push(
          {
            id: toolCalls[i].id,
            content: `Invalid tool call, tool ${toolCalls[i].id} not execute`
          }
        )
      }
    }
  }
  return toolResponses
}
