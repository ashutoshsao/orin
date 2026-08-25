import { context } from "./context";
import { config } from "./config";
import { DeepSeekProvider } from "./LLM_Providers/DeekSeek/DeekSeekProvider";
import { toolExecution } from "./tool";
import { LLMProvider, ToolType } from "./types";

const llmProvider = new DeepSeekProvider("deepseek-v4-flash", "low");

async function agentRun(llmProvider: LLMProvider, tools: ToolType, userPrompt: string, config: Record<string, string>) {

  //1. user input
  context.push({
    role: "user", content: userPrompt
  })

  console.log(` starting context \n\n ${JSON.stringify(context, null, 2)}`)

  let start = parseInt(config.initIteration)
  let end = parseInt(config.maxIteration)

  while (start <= end) {

    const response = await llmProvider.callLLM(context, tools)

    console.log(`iteration no: ${start}`)

    console.log(`the whole response \n\n ${JSON.stringify(response, null, 2)}`);

    // add assistant response to context
    if (response.status === "done") {
      context.push({ role: "assistant", content: response.content });
      console.log(`final agent response \n\n ${response.content}`);
      break;
    }
    else if (response.status === "error") {
      throw new Error(response.content)
    }
    else if (response.status === "toolCall") {
      //add requested tools to context
      context.push({
        role: "assistant", content: response.content
      })
      const toolResponse = await toolExecution(response.content.toolCalls)
      //add tool responses to context
      context.push({
        role: "tool", content: toolResponse
      })
    }

    start++
  }
}

agentRun(llmProvider, "can you list what is in current directory,then tell waht packages are installed in package.json", config);
