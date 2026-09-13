import { afterEach, describe, expect, test } from "bun:test";
import { closeLive, guestSlotAvailable, liveGuestCount, startLive, GUEST_SANDBOX_CAP } from "./liveSessions";
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
