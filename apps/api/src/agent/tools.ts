import type { Sandbox } from "e2b";
import { ToolCall, ToolDefinition, ToolResultType } from "./types";

// E2B's commands.run defaults cwd to the user's home (/home/user), NOT the image
// WORKDIR — so we pass the app dir explicitly to land where the template baked deps.
export const WORKDIR = "/home/user/react-template";
// A build/install can outrun the 60s per-command default; give it room.
const COMMAND_TIMEOUT_MS = 180_000;

export const tools: ToolDefinition[] = [
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
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Ask the user a clarifying question and wait for their answer. Prefer asking over assuming: whenever the request is ambiguous or you would otherwise guess at a preference, scope, tech choice, or design decision, ask instead of assuming. Provide suggested choices in `options` when there's a clear set (the user can still type their own); pass an empty array for an open question. The answer comes back as this tool's result.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "the question to show the user",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "suggested answers to offer as choices; empty array for a free-form question",
          },
        },
        required: ["question", "options"],
        additionalProperties: false,
      }
    },
    strict: true,
  }
]

// What a tool call needs from the session to run. `bash_tool` uses the sandbox;
// `ask_user` uses askUser (which emits an event and parks until the user answers).
export type ToolContext = {
  sandbox: Sandbox;
  askUser: (callId: string, question: string, options: string[]) => Promise<string>;
};

// Combine stdout+stderr like a real terminal — many tools (bun, vite) write
// progress/errors to stderr even on success, and the model needs to see it.
function combineOutput(out?: string, err?: string) {
  return [out, err].filter((s) => s && s.trim()).join("\n");
}

export async function toolExecution(toolCalls: ToolCall[], ctx: ToolContext) {
  const toolResponses: ToolResultType[] = [];
  for (let i = 0; i < toolCalls.length; i++) {
    switch (toolCalls[i].name) {
      case "bash_tool": {
        try {
          const command = toolCalls[i].argument.command as string;
          const result = await ctx.sandbox.commands.run(command, {
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

      case "ask_user": {
        // Parks until the user answers (via POST /answer). The tool_call id doubles
        // as the callId, so the answer comes back as this call's tool result —
        // keeping the tool_calls→result invariant intact.
        const question = toolCalls[i].argument.question as string;
        const options = (toolCalls[i].argument.options as unknown as string[]) ?? [];
        const answer = await ctx.askUser(toolCalls[i].id, question, options);
        toolResponses.push({ id: toolCalls[i].id, content: answer, ok: true });
        break;
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
