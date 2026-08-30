import OpenAI from "openai";
import { ContextType, EffortType, LLMResponseType, ToolCall, ToolDefinition } from "../../types";
import { DeepSeekMessage } from "./DeepSeek.types";
import { Env } from "../../../config";

//new api instance
const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: Env.DEEPSEEK_API_KEY
});

export class DeepSeekProvider {

  constructor(public model: string, public effort: EffortType) {
  }

  async callLLM(context: ContextType, tools: ToolDefinition[]): Promise<LLMResponseType> {
    try {
      //llm call
      console.log(`INTERNAL MESSAGES:\n${JSON.stringify(context, null, 2)}\n`)
      console.log(`INTERNAL TOOLS:\n${JSON.stringify(tools, null, 2)}\n`)
      const deekSeekMessages = transalteMessage(context)
      const deekSeekTools = translateTools(tools)
      console.log(`DEEPSEEK MESSAGES:\n${JSON.stringify(deekSeekMessages, null, 2)}\n`)
      console.log(`DEEPSEEK TOOLS:\n${JSON.stringify(deekSeekTools, null, 2)}\n`)
      const response = await openai.chat.completions.create({
        model: this.model,
        reasoning_effort: this.effort,
        messages: deekSeekMessages,
        tools: deekSeekTools,
        stream: false
      });

      if (response.choices[0].finish_reason === "stop") {

        // 1. final response - response body
        return { status: "done", content: response.choices[0].message.content! }

      } else if (response.choices[0].finish_reason === "tool_calls") {

        // 2. tool call - tool array for all requested tool calls
        const originalToolCalls = response.choices[0].message.tool_calls!;
        const toolsArr: ToolCall[] = [];
        for (let i = 0; i < originalToolCalls.length; i++) {
          toolsArr.push({
            id: originalToolCalls[i].id,
            name: originalToolCalls[i][originalToolCalls[i].type].name,
            argument: JSON.parse(originalToolCalls[i][originalToolCalls[i].type].arguments)
          })
        }
        return {
          status: "toolCall", content: {
            toolCalls: toolsArr,
            content: response.choices[0].message.content!,
            reasoningContent: response.choices[0].message.reasoning_content!
          }
        }
      } else {
        return { status: "exception", content: "unexpected error from llm" }
      }
    } catch (error) {
      return { status: "error", content: (error as Error).message }
    }
  }

}

function transalteMessage(context: ContextType) {

  const deekSeekContext: DeepSeekMessage[] = context.flatMap((msg): DeepSeekMessage | DeepSeekMessage[] => {
    switch (msg.role) {
      case "system": {
        return {
          role: "system",
          content: msg.content
        }
      }
      case "user": {
        return {
          role: "user",
          content: msg.content
        }
      }
      case "assistant": {
        if (typeof msg.content === "string") {
          return {
            role: "assistant",
            content: msg.content
          }
        } else {
          return {
            role: "assistant",
            content: msg.content.content,
            reasoning_content: msg.content.reasoningContent,
            tool_calls: msg.content.toolCalls.map((tool) => {
              return {
                id: tool.id,
                type: "function",
                function: {
                  name: tool.name,
                  arguments: JSON.stringify(tool.argument)
                }
              }
            })
          }
        }
      }
      case "tool": {
        const toolResults = msg.content.map(toolResult => {
          return {
            tool_call_id: toolResult.id,
            role: "tool" as const,
            content: toolResult.content
          }
        });
        return toolResults
      }
    }
  })
  return deekSeekContext
}

function translateTools(tools: ToolDefinition[]) {
  const deekSeepTools = [];
  for (let i = 0; i < tools.length; i++) {
    deekSeepTools.push({
      type: tools[i].type,
      function: {
        name: tools[i].function.name,
        description: tools[i].function.description,
        parameters: {
          type: tools[i].function.parameters.type,
          properties: tools[i].function.parameters.properties,
          required: tools[i].function.parameters.required,
          additionalProperties: tools[i].function.parameters.additionalProperties
        }
      },
      strict: tools[i].strict
    })
  }
  return deekSeepTools
}
