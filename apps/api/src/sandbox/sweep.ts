import { Sandbox } from "e2b";
import { SANDBOX_TAG } from "../agent/agent";

// A sandbox's lifetime is tied to its SSE connection: the stream's `finally` kills it.
// If the API process itself dies (Ctrl-C, crash, restart), that `finally` never runs and
// the sandbox keeps billing until its 1h safety timeout. A freshly booted server owns no
// sandboxes, so any still running with our tag are orphans — kill them on startup.
//
// Scoped by metadata, so other sandboxes on the E2B account are never touched.
// Assumes a single API instance: with several, one booting would kill its siblings'
// live sandboxes — then tag per instance and sweep only those whose owner stopped
// heartbeating (see future-considerations "Sandbox lifecycle").
export async function sweepOrphanSandboxes() {
  try {
    const pager = Sandbox.list({ query: { metadata: SANDBOX_TAG, state: ["running"] } });
    let killed = 0;
    while (pager.hasNext) {
      for (const s of await pager.nextItems()) {
        await Sandbox.kill(s.sandboxId);
        killed++;
      }
    }
    if (killed > 0) console.log(JSON.stringify({ event: "orphan_sandboxes_killed", count: killed }));
  } catch (e) {
    // Never block boot on housekeeping — the 1h timeout is still the backstop.
    console.log(JSON.stringify({ event: "orphan_sweep_error", message: String(e) }));
  }
}
