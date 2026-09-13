import { serverProvider } from "./LLM_Providers";
import { AgentSession } from "./agent";

const llmProvider = serverProvider("low");

// Sandbox is the workspace now — no local scaffoldWorkspace() / cwd anymore.
const session = await AgentSession.create(llmProvider);
try {
  await session.run("build me a todo app");
} finally {
  // Always tear the sandbox down, even if the run throws.
  await session.close();
}
