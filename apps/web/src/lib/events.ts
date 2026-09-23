import type { AgentEvent } from './api'

// The feed mixes two very different things: the conversation (what the user asked, what
// the agent answered) and telemetry (tool calls, snapshots, preview probes). Rendering
// them identically is what made the old feed read as noise — so classify first.
export type EventKind = 'user' | 'assistant' | 'question' | 'notice' | 'limit' | 'budget' | 'activity' | 'error'

// The orchestrator's step-limit note (written by agent.ts when a run hits maxIteration).
// Live it arrives as a `max_iterations_reached` event; after a reopen it's just a saved
// assistant message — so recognise its wording to render both the same way. Keep this in
// step with the note text in apps/api/src/agent/agent.ts.
const LIMIT_NOTE = /^I hit the \d+-step limit before finishing\./
// The account step-budget / expiry note (7a): live a `budget_exhausted` event, saved as an
// assistant message. Unlike the step limit there's nothing to continue. Keep in step with
// BUDGET_NOTES in apps/api/src/agent/agent.ts.
const BUDGET_NOTE = /^This (trial's step budget is used up|account's access has expired|account has no build access), so I stopped here\./

export function eventKind(e: AgentEvent): EventKind {
  switch (e.event) {
    case 'interrupted': return 'notice'
    case 'max_iterations_reached': return 'limit'
    case 'budget_exhausted': return 'budget'
    case 'run_start': return 'user'
    case 'final': {
      if (typeof e.content !== 'string') return 'assistant'
      if (LIMIT_NOTE.test(e.content)) return 'limit'
      return BUDGET_NOTE.test(e.content) ? 'budget' : 'assistant'
    }
    case 'ask_user': return 'question'
    case 'error':
    case 'exception':
    case 'stream_error':
    case 'unauthorized':
    case 'access_expired':
    case 'no_access':
    case 'byok_key_required':
    case 'busy':
    case 'project_not_found':
    case 'snapshot_error':
    case 'preview_failed':
    case 'preview_unreachable':
    case 'budget_error':
    case 'persist_error': return 'error'
    default: return 'activity'
  }
}

// Short label + detail for a telemetry row. Kept terse: the label carries the meaning,
// the detail only appears when it adds something.
export function activityLine(e: AgentEvent): { label: string; detail: string } {
  const tools = (e.tools as { name: string; ok: boolean }[] | undefined) ?? []
  switch (e.event) {
    case 'sandbox_created': return { label: 'environment', detail: 'ready' }
    case 'snapshot_restored': return { label: 'restored', detail: 'files from last snapshot' }
    case 'llm_call': return { label: 'thinking', detail: e.status === 'toolCall' ? '' : String(e.status ?? '') }
    case 'tool_call': return { label: 'ran', detail: tools.map((t) => `${t.name}${t.ok ? '' : ' (failed)'}`).join(', ') }
    case 'snapshot': return { label: 'snapshot', detail: String(e.commit ?? '').slice(0, 7) }
    case 'snapshot_skipped': return { label: 'not saved', detail: `workspace ${(Number(e.bytes) / 1024 / 1024).toFixed(1)} MB is over the snapshot limit` }
    case 'preview_ready': return { label: 'preview', detail: e.httpStatus === '200' ? 'live' : `status ${e.httpStatus}` }
    case 'preview_waiting': return { label: 'preview', detail: 'still starting' }
    // Deliberately wordless about the cause. The agent has the stderr and is fixing it;
    // showing a recruiter a stack trace makes Orin look broken, not the app being built.
    case 'preview_server_exited': return { label: 'preview', detail: 'restarting' }
    case 'preview_error': return { label: 'found', detail: 'an error in the app' }
    case 'preview_recovered': return { label: 'preview', detail: 'working again' }
    case 'preview_watch_unavailable': return { label: 'preview', detail: 'error watch unavailable' }
    case 'preview_repairing': return { label: 'fixing', detail: 'the preview' }
    case 'sandbox_closed': return { label: 'environment', detail: 'closed' }
    default: return { label: e.event.replace(/_/g, ' '), detail: '' }
  }
}

export function errorText(e: AgentEvent): string {
  switch (e.event) {
    case 'unauthorized': return 'You are not signed in.'
    case 'access_expired': return 'Your access to Orin has expired. Your projects are still saved.'
    case 'no_access': return 'This account has no access to Orin.'
    case 'byok_key_required': return 'Add your API key on the home screen to start building.'
    case 'busy': return 'Orin is at capacity for trial sessions. Try again in a few minutes.'
    case 'project_not_found': return 'That project could not be found.'
    // Only after the agent has had its attempts and the app still won't start. No stack
    // trace even here — the agent saw it; the user gets something they can act on.
    case 'preview_failed':
      return "The app still isn't starting after a couple of attempts to fix it. Tell the agent what you were expecting and it can try again."
    case 'preview_unreachable':
      return `The preview didn't come up in time (last response: ${e.httpStatus}). The app may still be starting — try reloading the preview.`
    default: return String(e.message ?? e.content ?? 'Something went wrong.')
  }
}

// A long build emits dozens of telemetry rows between two sentences of conversation.
// Group consecutive activity events so the feed reads as a conversation with collapsed
// work in between, rather than a wall of `ran bash_tool`.
export type FeedItem =
  | { type: 'message'; event: AgentEvent }
  | { type: 'activity'; events: AgentEvent[] }
  | { type: 'divider'; event: AgentEvent }

export function groupFeed(events: AgentEvent[]): FeedItem[] {
  const out: FeedItem[] = []
  for (const e of events) {
    // `run_active` is state the server sends a freshly-attached page ("a run is already
    // in progress, at step N") — it drives the status bar, but isn't something to show.
    if (e.event === 'run_active') continue
    // A new sandbox after earlier history means the project was reopened. Mark the
    // boundary, so the new session's telemetry ("environment ready", "restored") starts
    // its own group instead of reading as part of whatever run came before it.
    if (e.event === 'sandbox_created' && out.length > 0) out.push({ type: 'divider', event: e })
    if (eventKind(e) === 'activity') {
      const last = out[out.length - 1]
      if (last && last.type === 'activity') last.events.push(e)
      else out.push({ type: 'activity', events: [e] })
    } else {
      out.push({ type: 'message', event: e })
    }
  }
  return out
}

// One-line summary of a collapsed group, in the agent's own units:
//   step    = one round (an LLM call that chose tools, then those tools ran) — the same
//             "step" as the preview bar's "building · step N"
//   command = one tool call; a single step can issue several
// Steps are counted from tool_call events: each round emits exactly one, both live and
// when replayed from history, so the number no longer changes after a reopen. (It used
// to count every telemetry event — llm_call + tool_call + snapshot… — i.e. ~3× live.)
export function summarizeActivity(events: AgentEvent[]): string {
  const rounds = events.filter((e) => e.event === 'tool_call')
  const commands = rounds.flatMap((e) => (e.tools as { name: string }[] | undefined) ?? []).length
  if (rounds.length === 0) {
    // Session housekeeping (environment ready, restored, preview) — no agent work; name it.
    return [...new Set(events.map((e) => activityLine(e).label))].join(' · ')
  }
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  return `${s(rounds.length, 'step')} · ${s(commands, 'command')}`
}

// What the agent is doing right now, for the preview bar's status. Only *live* events
// count (they carry a sessionId, or are our own optimistic prompt): replayed history
// has neither, and a transcript whose last run never finished must not read as
// "building" forever on reopen. A run starts at run_start and ends at any of RUN_ENDS.
const RUN_ENDS = new Set(['final', 'error', 'exception', 'max_iterations_reached', 'budget_exhausted', 'budget_error'])

// Whether the generated app currently fails to compile. This is why the bar can't just say
// "preview · live" whenever a URL exists: Vite keeps serving (and answering 200) while showing
// its overlay for a broken module, so for a while the bar confidently said the opposite of what
// the user was looking at. `preview_error` / `preview_recovered` come from the HMR watcher.
function appBroken(events: AgentEvent[]): boolean {
  let broken = false
  for (const e of events) {
    if (!e.sessionId && !e.local) continue
    if (e.event === 'preview_error' || e.event === 'preview_failed') broken = true
    else if (e.event === 'preview_recovered' || e.event === 'snapshot_restored') broken = false
  }
  return broken
}

export type RunStatus = { label: string; active: boolean; building: boolean }

export function runStatus(
  events: AgentEvent[],
  o: { pending: boolean; hasPreview: boolean; online: boolean },
): RunStatus {
  if (!o.online) return { label: 'offline', active: false, building: false }
  if (o.pending) return { label: 'waiting for you', active: true, building: false }
  let lastStart = -1
  let lastEnd = -1
  let endedBy = ''
  let step: number | undefined
  events.forEach((e, i) => {
    if (!e.sessionId && !e.local) return
    if (e.event === 'run_start') { lastStart = i; step = undefined }
    // Joined a session mid-run: the server tells us the run is live and which step it's on.
    else if (e.event === 'run_active') { lastStart = i; step = typeof e.step === 'number' ? e.step : undefined }
    else if (RUN_ENDS.has(e.event)) { lastEnd = i; endedBy = e.event }
    else if (e.event === 'llm_call' && typeof e.iteration === 'number') step = e.iteration
  })
  const broken = appBroken(events)
  if (lastStart > lastEnd) {
    // Mid-run with a broken app: the agent is about to be handed the error, so say what's
    // happening rather than a step count the user can't act on.
    if (broken) return { label: 'fixing an error', active: true, building: true }
    return { label: step ? `building · step ${step}` : 'building', active: true, building: true }
  }
  // Run over and it still doesn't compile — never "preview · live" on top of an error screen.
  if (broken) return { label: 'needs a fix', active: false, building: false }
  // A run cut off by the step limit is not "live" — saying so is the whole point.
  if (endedBy === 'max_iterations_reached') return { label: 'stopped · step limit', active: false, building: false }
  if (endedBy === 'budget_exhausted') return { label: 'stopped · trial ended', active: false, building: false }
  if (o.hasPreview) return { label: 'preview · live', active: false, building: false }
  return { label: 'starting', active: true, building: false }
}
