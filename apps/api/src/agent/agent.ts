import OpenAI from "openai";
import { tool_execution, tools } from "./tools";
import { context } from "./context";
import { config } from "./config";
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  // apiKey: process.env.DEEPSEEK_API_KEY,
  apiKey: process.env.DEEPSEEK_API_KEY,
});

async function agentRun(context: unknown, user_prompt: string, config: Record<string, string>) {

  //1. user input
  context.push({
    role: "user", content: user_prompt
  })

  let initIteration = 0;

  console.log(` starting context \n ${JSON.stringify(context, null, 2)}`)

  while (initIteration <= parseInt(config.maxIteration)) {

    const turn1 = await openai.chat.completions.create({
      model: "deepseek-v4-flash",
      reasoning_effort: "low",
      messages: context,
      tools,
      stream: false,
    });

    console.log(`${initIteration++}`)

    console.log(`the whole turn1 response \n ${JSON.stringify(turn1, null, 2)}`);

    // add assistant response to context
    context.push(turn1.choices[0].message);

    //if function call so add it to the context, then execute it and add that to message then send to 
    if (turn1.choices[0].message.tool_calls && turn1.choices[0].message.tool_calls.length !== 0) {
      const tool_response = await tool_execution({ name: turn1.choices[0].message.tool_calls[0].function.name, arguments: turn1.choices[0].message.tool_calls[0].function.arguments })

      context.push({
        role: "tool", tool_call_id: turn1.choices[0].message.tool_calls[0].id, content: JSON.stringify(tool_response)
      })

      console.log(`3. tool call responses ${JSON.stringify(turn1.choices[0].message.tool_calls, null, 2)}`)
    }

    const turn2 = await openai.chat.completions.create({
      model: "deepseek-v4-flash",
      reasoning_effort: "low",
      messages: context,
      tools,
      stream: false,
    });

    console.log("4. turn2 ----------")
    console.log(`whole turn2 body \n ${JSON.stringify(turn2, null, 2)}`);
    console.log(`body inside content \n ${turn2.choices[0].message.content}`);

    context.push({ role: "assistant", content: turn2.choices[0].message.content })
  }
}

agentRun(context, "can you list what is in current directory", config);
