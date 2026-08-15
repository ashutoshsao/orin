import { DeepSeekProvider } from "./LLM_Providers/DeepSeek/DeepSeek.interface";
import { scaffoldWorkspace } from "../sandbox/scaffoldWorkspace";
import { AgentSession } from "./agent";

const llmProvider = new DeepSeekProvider("deepseek-v4-flash", "low");
const workspace = await scaffoldWorkspace();

const session = new AgentSession(llmProvider, workspace);
await session.run("build me a todo app");
