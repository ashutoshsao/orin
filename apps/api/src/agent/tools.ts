import type { Sandbox } from "e2b";
import { ToolCall, ToolResultType } from "./types";

// E2B's commands.run defaults cwd to the user's home (/home/user), NOT the image
// WORKDIR — so we pass the app dir explicitly to land where the template baked deps.
const WORKDIR = "/home/user/react-template";
// A build/install can outrun the 60s per-command default; give it room.
const COMMAND_TIMEOUT_MS = 180_000;

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

// Combine stdout+stderr like a real terminal — many tools (bun, vite) write
// progress/errors to stderr even on success, and the model needs to see it.
function combineOutput(out?: string, err?: string) {
  return [out, err].filter((s) => s && s.trim()).join("\n");
}

export async function toolExecution(toolCalls: ToolCall[], sandbox: Sandbox) {
  const toolResponses: ToolResultType[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    switch (toolCalls[i].name) {
      case "bash_tool": {
        try {
          const command = toolCalls[i].argument.command as string;
          const result = await sandbox.commands.run(command, {
            cwd: WORKDIR,
            timeoutMs: COMMAND_TIMEOUT_MS,
          });
          toolResponses.push({
            id: toolCalls[i].id,
            content: combineOutput(result.stdout, result.stderr),
            ok: true,
          });
          break;
        } catch (e) {
          // Non-zero exit throws CommandExitError (carries stdout/stderr/exitCode);
          // feed the output back to the model as a failed result, never rethrow.
          const err = e as { stdout?: string; stderr?: string; message?: string };
          toolResponses.push({
            id: toolCalls[i].id,
            content: combineOutput(err.stdout, err.stderr) || err.message || String(e),
            ok: false,
          });
          break;
        }
      }

      default: {
        toolResponses.push(
          {
            id: toolCalls[i].id,
            content: `Invalid tool call, tool ${toolCalls[i].id} not execute`,
            ok: false
          }
        )
        break;
      }
    }
  }
  return toolResponses
}
