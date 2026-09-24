// How many times ONE BREAKAGE is handed back to the agent before we stop and ask the user — a
// dead dev server or a module that won't compile. The allowance refills as soon as the app is
// proven healthy again, so a later, unrelated break gets its own two tries.
//
// This is not a safety device: `maxIteration` already bounds a run and the step budget bounds an
// account, so an uncapped repair loop would still terminate. It's a product decision about when
// to stop retrying silently. Two rounds of "done" → "no, it's broken" is a fix in progress; ten
// is the agent stuck, and by then the user is better placed to redirect it than we are.
export const MAX_REPAIRS = 2;

export const config = {
  maxIteration: "20",
  initIteration: "1",
}
