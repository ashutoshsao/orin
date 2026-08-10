import OpenAI from "openai";
import { tool_execution, tools } from "./tools";
import { context } from "./context";
import { config } from "./config";
const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

async function agentRun(context: unknown, user_prompt: string, config: Record<string, string>) {

  //1. user input
  context.push({
    role: "user", content: user_prompt
  })

  let initIteration = 1;

  console.log(` starting context \n ${JSON.stringify(context, null, 2)}`)

  while (initIteration <= parseInt(config.maxIteration)) {

    const response = await openai.chat.completions.create({
      model: "deepseek-v4-flash",
      reasoning_effort: "low",
      messages: context,
      tools,
      stream: false,
    });

    console.log(`iteration no: ${initIteration++}`)

    console.log(`the whole response \n ${JSON.stringify(response, null, 2)}`);

    // add assistant response to context
    context.push(response.choices[0].message);

    const toolCalls = response.choices[0].message.tool_calls

    //if function call so add it to the context, then execute it and add that to message then send to 
    if (!toolCalls) {
      //agent is returning final response
      console.log(`final agent response \n ${response.choices[0].message.content}`);
      return;
    }

    for (let i = 0; i < toolCalls.length; i++) {
      let toolResponse = await tool_execution(toolCalls[i].function);
      console.log(`tool reponse ${i} : ${JSON.stringify(toolResponse)}`)
      context.push({
        role: "tool", tool_call_id: toolCalls[i].id, content: JSON.stringify(toolResponse)
      })
    }
  }
}

agentRun(context, "can you list what is in current directory,then tell waht packages are installed in package.json", config);
