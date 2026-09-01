import type { AgentEvent } from './api'

// The feed mixes two very different things: the conversation (what the user asked, what
// the agent answered) and telemetry (tool calls, snapshots, preview probes). Rendering
// them identically is what made the old feed read as noise — so classify first.
export type EventKind = 'user' | 'assistant' | 'question' | 'notice' | 'activity' | 'error'

export function eventKind(e: AgentEvent): EventKind {
  switch (e.event) {
    case 'interrupted': return 'notice'
    case 'run_start': return 'user'
    case 'final': return 'assistant'
    case 'ask_user': return 'question'
    case 'error':
    case 'exception':
    case 'stream_error':
    case 'unauthorized':
    case 'project_not_found':
    case 'snapshot_error':
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
    case 'preview_ready': return { label: 'preview', detail: e.httpStatus === '200' ? 'live' : `status ${e.httpStatus}` }
    case 'sandbox_closed': return { label: 'environment', detail: 'closed' }
    case 'max_iterations_reached': return { label: 'stopped', detail: 'hit the step limit' }
    default: return { label: e.event.replace(/_/g, ' '), detail: '' }
  }
}

export function errorText(e: AgentEvent): string {
  switch (e.event) {
    case 'unauthorized': return 'You are not signed in.'
    case 'project_not_found': return 'That project could not be found.'
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

// One-line summary of a collapsed group: lead with what was actually done (tools run)
// rather than the raw step count, which tells the reader nothing.
export function summarizeActivity(events: AgentEvent[]): string {
  const tools = events
    .filter((e) => e.event === 'tool_call')
    .flatMap((e) => (e.tools as { name: string }[] | undefined) ?? [])
  const steps = events.length
  if (tools.length === 0) return `${steps} step${steps === 1 ? '' : 's'}`
  return `${tools.length} command${tools.length === 1 ? '' : 's'} · ${steps} steps`
}

// What the agent is doing right now, for the preview bar's status. Only *live* events
// count (they carry a sessionId, or are our own optimistic prompt): replayed history
// has neither, and a transcript whose last run never finished must not read as
// "building" forever on reopen. A run starts at run_start and ends at any of RUN_ENDS.
const RUN_ENDS = new Set(['final', 'error', 'exception', 'max_iterations_reached'])

export type RunStatus = { label: string; active: boolean; building: boolean }

export function runStatus(
  events: AgentEvent[],
  o: { pending: boolean; hasPreview: boolean; online: boolean },
): RunStatus {
  if (!o.online) return { label: 'offline', active: false, building: false }
  if (o.pending) return { label: 'waiting for you', active: true, building: false }
  let lastStart = -1
  let lastEnd = -1
  let step: number | undefined
  events.forEach((e, i) => {
    if (!e.sessionId && !e.local) return
    if (e.event === 'run_start') { lastStart = i; step = undefined }
    else if (RUN_ENDS.has(e.event)) lastEnd = i
    else if (e.event === 'llm_call' && typeof e.iteration === 'number') step = e.iteration
  })
  if (lastStart > lastEnd) {
    return { label: step ? `building · step ${step}` : 'building', active: true, building: true }
  }
  if (o.hasPreview) return { label: 'preview · live', active: false, building: false }
  return { label: 'starting', active: true, building: false }
}
