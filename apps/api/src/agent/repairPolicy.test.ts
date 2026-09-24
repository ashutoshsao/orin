import { describe, expect, test } from "bun:test";
import { freshRepairState, nextRepair } from "./repairPolicy";

const ERR = "Transform failed: [PARSE_ERROR] Unexpected token";
const OTHER = "Transform failed: [PARSE_ERROR] Unterminated string";

describe("nextRepair", () => {
  test("a fresh breakage is handed over with its text", () => {
    const d = nextRepair(freshRepairState(2), ERR, 2);
    expect(d).toEqual({ kind: "handoff", report: true, state: { repairsLeft: 1, lastReported: ERR } });
  });

  // The bug this replaced: the counter measured how often we MENTIONED the error, so a fix that
  // took a read and then an edit — the normal shape — spent both attempts and failed a repair
  // that was going fine.
  test("the same error isn't repeated, but the turn still counts", () => {
    const after = nextRepair(freshRepairState(2), ERR, 2).state;
    const d = nextRepair(after, ERR, 2);
    expect(d).toEqual({ kind: "handoff", report: false, state: { repairsLeft: 0, lastReported: ERR } });
  });

  test("a different error is worth telling the agent about", () => {
    const after = nextRepair(freshRepairState(3), ERR, 3).state;
    expect(nextRepair(after, OTHER, 3)).toMatchObject({ kind: "handoff", report: true });
  });

  test("read then fix: two turns is enough to recover", () => {
    let s = freshRepairState(2);
    s = nextRepair(s, ERR, 2).state;            // turn 1 — agent reads
    s = nextRepair(s, ERR, 2).state;            // turn 2 — agent edits
    const done = nextRepair(s, null, 2);        // compiles again
    expect(done.kind).toBe("recovered");
  });

  test("out of turns, it hands back to the user instead of looping", () => {
    let s = freshRepairState(2);
    s = nextRepair(s, ERR, 2).state;
    s = nextRepair(s, ERR, 2).state;
    expect(nextRepair(s, ERR, 2)).toMatchObject({ kind: "giveup" });
  });

  // The other bug: the allowance was a session field set once, so two early breaks left every
  // later break silently unrepaired for the rest of the session.
  test("recovery refills, so a later unrelated break gets its own turns", () => {
    let s = freshRepairState(2);
    s = nextRepair(s, ERR, 2).state;
    s = nextRepair(s, ERR, 2).state;
    expect(s.repairsLeft).toBe(0);

    s = nextRepair(s, null, 2).state;           // fixed
    expect(s).toEqual({ repairsLeft: 2 });      // and lastReported is cleared

    // A much later, different break is treated as new — text sent, full allowance.
    expect(nextRepair(s, OTHER, 2)).toMatchObject({ kind: "handoff", report: true });
  });

  test("recovery clears the reported text, so the same error later is reported again", () => {
    const broken = nextRepair(freshRepairState(2), ERR, 2).state;
    const healthy = nextRepair(broken, null, 2).state;
    expect(nextRepair(healthy, ERR, 2)).toMatchObject({ kind: "handoff", report: true });
  });

  test("a healthy app is always 'recovered', never a handoff", () => {
    expect(nextRepair({ repairsLeft: 0, lastReported: ERR }, null, 2).kind).toBe("recovered");
  });

  test("a cap of zero means never auto-repair", () => {
    expect(nextRepair(freshRepairState(0), ERR, 0)).toMatchObject({ kind: "giveup" });
  });
});
