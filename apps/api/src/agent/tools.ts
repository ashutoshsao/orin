import { $ } from "bun"
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

export async function tool_execution({ name, arguments: args }) {
  switch (name) {
    case "bash_tool": {
      const { command } = JSON.parse(args);
      return await $`sh -c ${command}`.text();
    }

    default:
      return "Invalid syntax";
  }
}
