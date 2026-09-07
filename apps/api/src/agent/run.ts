import { DeepSeekProvider } from "./LLM_Providers/DeepSeek/DeepSeek.interface";
import { AgentSession } from "./agent";

const llmProvider = new DeepSeekProvider("deepseek-v4-flash", "low");

// Sandbox is the workspace now — no local scaffoldWorkspace() / cwd anymore.
const session = await AgentSession.create(llmProvider);
try {
  await session.run("build me a todo app");
} finally {
  // Always tear the sandbox down, even if the run throws.
  await session.close();
}
