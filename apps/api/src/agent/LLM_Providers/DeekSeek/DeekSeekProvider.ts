import OpenAI from "openai";
import { tools } from "./tool";
import { effortType, llmResponseType } from "../../types";
import { contextType } from "../../context";

const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  apiKey: process.env.DEEPSEEK_API_KEY,
});

export class DeepSeekProvider {
  model: string
  effort: string

  constructor(model: string, effort: effortType) {
    this.model = model;
    this.effort = effort;
  }

  async call_LLM(context: contextType): Promise<llmResponseType> {
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
        status: "tool_call", content: { tool_calls: response.choices[0].message.tool_calls, content: response.choices[0].message.content, reasoning_content: response.choices[0].message.reasoning_content }
      }
    } catch (error) {
      return { status: "error", content: (error as Error).message }
    }
  }

}
