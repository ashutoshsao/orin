import type { AgentEvent } from './api'

// The feed mixes two very different things: the conversation (what the user asked, what
// the agent answered) and telemetry (tool calls, snapshots, preview probes). Rendering
// them identically is what made the old feed read as noise — so classify first.
export type EventKind = 'user' | 'assistant' | 'question' | 'activity' | 'error'

export function eventKind(e: AgentEvent): EventKind {
  switch (e.event) {
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
