import { MAX_REPAIRS } from "./config";

// When a broken preview gets handed back to the agent, and when we stop and ask the user.
//
// Extracted from AgentSession because every bug in this logic so far was a state bug, not a
// sandbox bug — the allowance was scoped to the session instead of the incident, and the counter
// measured how often we mentioned the error rather than how many turns the agent had spent on it.
// Neither needs a live VM to get wrong, so neither should need one to test.
export type RepairState = {
  // Turns remaining on the CURRENT breakage. Refills on recovery, so a later, unrelated break
  // gets its own allowance.
  repairsLeft: number;
  // The error text already in the agent's context, so it isn't pushed again every round.
  lastReported?: string;
};

export type RepairAction =
  // Compiles again: refill and say so.
  | { kind: "recovered"; state: RepairState }
  // Give it to the agent. `report` is false when the same text is already in context — the turn
  // still counts, we just don't repeat ourselves.
  | { kind: "handoff"; report: boolean; state: RepairState }
  // Out of turns. The run should end so the user can redirect it.
  | { kind: "giveup"; state: RepairState };

export const freshRepairState = (max = MAX_REPAIRS): RepairState => ({ repairsLeft: max });

export function nextRepair(
  state: RepairState,
  // The error still standing after revalidation, or null if the app compiles again.
  error: string | null,
  max = MAX_REPAIRS,
): RepairAction {
  if (error === null) return { kind: "recovered", state: freshRepairState(max) };
  if (state.repairsLeft <= 0) return { kind: "giveup", state };
  return {
    kind: "handoff",
    report: error !== state.lastReported,
    state: { repairsLeft: state.repairsLeft - 1, lastReported: error },
  };
}
