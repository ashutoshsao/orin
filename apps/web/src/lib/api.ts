// Server contract + shared shapes for the builder UI.
// Set VITE_API_URL at build time (Vercel env) for deployments; the fallback is the local
// API from `bun run dev`. Baked in at build — changing it needs a redeploy, not a restart.
export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export type Project = { id: string; name: string; createdAt: string }

// One structured agent event off the SSE stream.
export type AgentEvent = {
  event: string; sessionId?: string; iteration?: number; status?: string
  content?: unknown; url?: string; httpStatus?: string; callId?: string
  question?: string; options?: string[]; [k: string]: unknown
}

export type Pending = { callId: string; question: string; options: string[] }

// A persisted conversation message (GET /projects/:id/messages).
export type StoredMessage = { seq: number; role: string; content: unknown; createdAt?: string }

// A rewind point (GET /projects/:id/snapshots): one pushed codebase snapshot.
export type Snap = { id: string; commitHash: string; n: number; createdAt: string }

// Every call carries the session cookie (the API is a separate origin).
export const authed: RequestInit = { credentials: 'include' }

export async function postJSON(path: string, body: unknown) {
  return fetch(`${API}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getJSON<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API}${path}`, authed)
    return res.ok ? ((await res.json()) as T) : fallback
  } catch {
    return fallback
  }
}

// Map persisted messages to feed events so reopening replays the transcript. Skips
// system + raw tool results (noise); agent memory is restored server-side regardless.
// Mirrors commandLine() in apps/api/src/agent/agent.ts — the live event arrives already trimmed,
// but history is raw rows, so the same rule is applied here. Keep the two in step.
const COMMAND_LINE_MAX = 160
// Every command already runs in the app directory, so a leading `cd` there is 32 characters of
// noise at the head of every row. Stripped here too, for transcripts written before the rule.
const REDUNDANT_CD = /^cd\s+\/home\/user\/react-template\s*&&\s*/
function commandLine(command: string | undefined): string | undefined {
  if (!command) return undefined
  const first = command.split('\n', 1)[0]!.trim().replace(REDUNDANT_CD, '')
  if (!first) return undefined
  return first.length > COMMAND_LINE_MAX ? `${first.slice(0, COMMAND_LINE_MAX)}\u2026` : first
}

export function historyToEvents(messages: StoredMessage[]): AgentEvent[] {
  const out: AgentEvent[] = []
  for (const m of messages) {
    const ts = m.createdAt
    if (m.role === 'user') {
      out.push({ event: 'run_start', userPrompt: String(m.content), ts })
    } else if (m.role === 'assistant') {
      if (typeof m.content === 'string') {
        out.push({ event: 'final', content: m.content, ts })
      } else {
        const calls = (m.content as { toolCalls?: { name: string; argument?: { command?: string } }[] })?.toolCalls ?? []
        // Same first-line-of-the-command treatment the live event gets (agent.ts commandLine),
        // so a reopened project reads identically to one you watched being built.
        if (calls.length) out.push({
          event: 'tool_call',
          tools: calls.map((t) => ({ name: t.name, ok: true, command: commandLine(t.argument?.command) })),
          ts,
        })
      }
    }
  }
  // A run that never produced a final answer was cut off (tab closed, reopened, crashed).
  // Say so — otherwise a half-finished change (and a possibly broken preview) looks like
  // the finished state, with nothing telling you why.
  let lastUser = -1
  let lastFinal = -1
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUser = i
    else if (m.role === 'assistant' && typeof m.content === 'string') lastFinal = i
  })
  if (lastUser > lastFinal) out.push({ event: 'interrupted', ts: messages.at(-1)?.createdAt })
  return out
}

// "14:02" — the chat gutter's clock. Local time, 24h, no seconds.
export function clockTime(iso: unknown): string {
  if (typeof iso !== 'string') return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Relative time, for timestamps that should read as prose rather than data.
export function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
