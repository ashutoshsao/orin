// How many times one run will hand a broken preview back to the agent — a dead dev server or
// a module that won't compile. A cap matters: a fault the model can't fix would otherwise loop
// until the step budget is gone. The trial allowance is sized off this (persistence/access.ts).
export const MAX_REPAIRS = 2;

export const config = {
  maxIteration: "20",
  initIteration: "1",
}
