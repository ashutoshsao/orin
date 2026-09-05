import { context } from "./context";
import { config } from "./config";
import { DeepSeekProvider } from "./LLM_Providers/DeepSeek/DeepSeek.interface";
import { toolExecution, tools } from "./tools";
import { LLMProvider, ToolDefinition } from "./types";
import { scaffoldWorkspace } from "../sandbox/scaffoldWorkspace";

const llmProvider = new DeepSeekProvider("deepseek-v4-flash", "low");

async function agentRun(llmProvider: LLMProvider, tools: ToolDefinition[], userPrompt: string, config: Record<string, string>, cwd: string) {

  //1. user input
  context.push({
    role: "user", content: userPrompt
  })

  console.log(`CONTEXT BEFORE LLM\n${JSON.stringify(context, null, 2)}\n`)

  let start = parseInt(config.initIteration)
  let end = parseInt(config.maxIteration)

  while (start <= end) {

    const response = await llmProvider.callLLM(context, tools);

    console.log(`ITERATION NO: ${start}`)

    console.log(`WHOLE RESPONSE OBJECT\n${JSON.stringify(response, null, 2)}\n`);

    // add assistant response to context
    if (response.status === "done") {

      context.push({ role: "assistant", content: response.content });
      console.log(`FINAL ANSWER\n${JSON.stringify(response.content, null, 2)}\n`);
      break;

    } else if (response.status === "toolCall") {

      //add requested tools to context
      context.push({
        role: "assistant", content: response.content
      })
      console.log(`TOOL CALL REQUESTED\n${JSON.stringify(response.content, null, 2)}\n`);
      const toolResponse = await toolExecution(response.content.toolCalls, cwd)
      //add tool responses to context
      context.push({
        role: "tool", content: toolResponse
      })
      console.log(`TOOL RESULTS\n${JSON.stringify(toolResponse, null, 2)}\n`);

    } else if (response.status === "error") {
      console.log(response.content)
      break;
    } else {
      console.log(response.content)
      break;
    }

    start++
  }
}

const workspace = await scaffoldWorkspace();
agentRun(llmProvider, tools, "build me a todo app", config, workspace);
