import { DeepSeekProvider } from "./LLM_Providers/DeepSeek/DeepSeek.interface";
import { AgentSession } from "./agent";

// Like run.ts, but keeps the sandbox alive after the build and serves the app so
// you can open it in a browser — and independently confirms it responds 200,
// rather than trusting the agent's own "done" claim.
const llmProvider = new DeepSeekProvider("deepseek-v4-flash", "low");
const session = await AgentSession.create(llmProvider);

try {
  await session.run("Build a platform where organizers can create events, manage registrations, and track attendance.Only two page");

  const { url, httpStatus } = await session.startPreview();
  console.log("\n────────────────────────────────────────");
  console.log(`  independent check: server responded ${httpStatus}`);
  console.log(`  preview URL:       ${url}`);
  console.log("────────────────────────────────────────");

  // Hold the sandbox open until you're done looking, then tear it down.
  prompt("\nPress Enter to shut down the sandbox…");
} finally {
  await session.close();
}
