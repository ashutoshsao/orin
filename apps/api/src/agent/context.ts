import { ContextType, LLMProvider } from "./types";

export class AgentSession {
  private context: ContextType;
  constructor(private llmProvider: LLMProvider, private cwd: string) {
    this.context = [
      { role: "system", content: "You are a helpful assistant, also you are provided with tools you can provide with commands that can be execute" },
    ];
  }
  async run(userPrompt: string) {/* user this.context, this.cwd*/ }
}
