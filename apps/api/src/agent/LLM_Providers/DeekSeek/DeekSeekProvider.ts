import OpenAI from "openai";
import { tools } from "../../tool";
import { ContextType, EffortType, LLMResponseType } from "../../types";

const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export class DeepSeekProvider {
  model: string
  effort: EffortType

  constructor(model: string, effort: EffortType) {
    this.model = model;
    this.effort = effort;
  }

  async callLLM(context: ContextType): Promise<LLMResponseType> {
    // two return types 
    try {
      //llm call
      const response = await openai.chat.completions.create({
        model: this.model,
        reasoning_effort: this.effort,
        messages: context,
        tools,
        stream: false,
      });

      if (response.choices[0].finish_reason === "stop") {
        // 1. final response - response body
        return { status: "done", content: response.choices[0].message.content }
      }
      else return {
        // 2. tool call - tool array for all requested tool calls
        status: "toolCall", content: { tool_calls: response.choices[0].message.tool_calls, content: response.choices[0].message.content, reasoning_content: response.choices[0].message.reasoning_content }
      }
    } catch (error) {
      return { status: "error", content: (error as Error).message }
    }
  }

}
