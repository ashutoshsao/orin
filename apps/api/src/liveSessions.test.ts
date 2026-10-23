import { afterEach, describe, expect, test } from "bun:test";
import { closeLive, getLive, guestSlotAvailable, liveGuestCount, startLive, subscribe, unsubscribe, GUEST_SANDBOX_CAP } from "./liveSessions";
import type { AgentEvent } from "./agent/agent";
import type { AgentSession } from "./agent/agent";

// The cap exists so a busy afternoon on the portfolio can't spin up unbounded E2B VMs.
const stub = () => ({ id: crypto.randomUUID(), submit: async () => {}, answer: () => true, close: async () => {} }) as unknown as AgentSession;
const opened: string[] = [];

async function open(projectId: string, userId: string, limited: boolean) {
  opened.push(projectId);
  startLive(projectId, userId, limited, async () => ({ session: stub(), afterReady: async () => {} }));
  await Bun.sleep(20);
}

afterEach(async () => {
  for (const id of opened.splice(0)) await closeLive(id);
});

describe("global sandbox cap for limited accounts", () => {
  test("counts only limited sessions", async () => {
    await open("cap-allowlist", "owner", false);
    expect(liveGuestCount()).toBe(0); // allowlist sessions are never counted
    await open("cap-guest-1", "guest-1", true);
    expect(liveGuestCount()).toBe(1);
  });

  test("refuses a new guest session at the cap, but lets an existing project reattach", async () => {
    for (let i = 0; i < GUEST_SANDBOX_CAP; i++) await open(`cap-full-${i}`, `guest-${i}`, true);
    expect(liveGuestCount()).toBe(GUEST_SANDBOX_CAP);
    expect(guestSlotAvailable("cap-a-new-project")).toBe(false);
    expect(guestSlotAvailable("cap-full-0")).toBe(true); // already live — reattaching costs nothing

    await closeLive("cap-full-0");
    expect(guestSlotAvailable("cap-a-new-project")).toBe(true); // a slot freed up
  });
});

// Closing the tab mid-build used to start the 60s countdown at once, killing the sandbox
// halfway through a turn. Now the countdown starts when the turn ends (or parks on ask_user).
describe("grace period waits for the running turn", () => {
  const GRACE = 50;
  const sub = { push: () => {}, end: () => {} };
  let emit: (e: AgentEvent) => void = () => {};
  const event = (name: string) => emit({ ts: new Date().toISOString(), sessionId: "", event: name } as AgentEvent);

  async function openWatched(projectId: string) {
    process.env.ORIN_GRACE_MS = String(GRACE);
    opened.push(projectId);
    const live = startLive(projectId, "owner", false, async (onEvent) => {
      emit = onEvent;
      return { session: stub(), afterReady: async () => {} };
    });
    subscribe(live, sub);
    await Bun.sleep(20);
    return live;
  }

  afterEach(() => { delete process.env.ORIN_GRACE_MS; });

  test("a viewer leaving mid-turn doesn't close the session until the turn ends", async () => {
    const live = await openWatched("grace-mid-turn");
    event("run_start");
    unsubscribe(live, sub);
    await Bun.sleep(GRACE * 3);
    expect(getLive("grace-mid-turn")).toBeDefined(); // still building

    event("final");
    await Bun.sleep(GRACE * 3);
    expect(getLive("grace-mid-turn")).toBeUndefined(); // closed one grace period after the turn
  });

  test("a turn parked on ask_user with nobody watching starts the countdown", async () => {
    const live = await openWatched("grace-ask");
    event("run_start");
    unsubscribe(live, sub);
    event("ask_user");
    await Bun.sleep(GRACE * 3);
    expect(getLive("grace-ask")).toBeUndefined();
  });

  test("an idle session still closes one grace period after the last viewer leaves", async () => {
    const live = await openWatched("grace-idle");
    unsubscribe(live, sub);
    await Bun.sleep(GRACE * 3);
    expect(getLive("grace-idle")).toBeUndefined();
  });

  test("a viewer returning cancels the countdown", async () => {
    const live = await openWatched("grace-return");
    unsubscribe(live, sub);
    subscribe(live, sub);
    await Bun.sleep(GRACE * 3);
    expect(getLive("grace-return")).toBeDefined();
  });
});
