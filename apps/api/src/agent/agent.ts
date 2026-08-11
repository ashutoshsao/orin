import { context } from "./context";
import { config } from "./config";
import { DeepSeekProvider } from "./LLM_Providers/DeekSeek/DeekSeekProvider";
import { tool_execution } from "./LLM_Providers/DeekSeek/tool";

const LLM_Provider = new DeepSeekProvider("deepseek-v4-flash", "low");

async function agentRun(LLM_Provider: DeepSeekProvider, user_prompt: string, config: Record<string, string>) {

  //1. user input
  context.push({
    role: "user", content: user_prompt
  })

  console.log(` starting context \n\n ${JSON.stringify(context, null, 2)}`)

  let start = parseInt(config.initIteration)
  let end = parseInt(config.maxIteration)

  while (start <= end) {

    const response = await LLM_Provider.call_LLM(context)

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
    else if (response.status === "tool_call") {
      //add requested tools to context
      context.push({
        role: "assistant", content: response.content
      })
      const toolResponse = await tool_execution(response.content.toolCalls)
      //add tool responses to context
      context.push({
        role: "tool", content: toolResponse
      })
    }

    start++
  }
}

agentRun(LLM_Provider, "can you list what is in current directory,then tell waht packages are installed in package.json", config);
