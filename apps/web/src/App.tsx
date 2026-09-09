import { useRef, useState } from 'react'

const API = 'http://localhost:4000'

type AgentEvent = {
  event: string
  sessionId?: string
  iteration?: number
  status?: string
  content?: unknown
  url?: string
  httpStatus?: string
  message?: string
  callId?: string
  question?: string
  options?: string[]
  [key: string]: unknown
}

type PendingQuestion = { callId: string; question: string; options: string[] }

function describe(e: AgentEvent): string {
  switch (e.event) {
    case 'sandbox_created': return `sandbox up (${e.sandboxId})`
    case 'run_start': return `▶ ${String(e.userPrompt ?? '')}`
    case 'llm_call': return `llm call #${e.iteration} → ${e.status}`
    case 'tool_call': return `tools #${e.iteration}: ${(e.tools as { name: string; ok: boolean }[] ?? []).map(t => `${t.name}${t.ok ? '✓' : '✗'}`).join(' ')}`
    case 'ask_user': return `❓ ${String(e.question ?? '')}`
    case 'final': return `✓ ${String(e.content ?? '')}`
    case 'max_iterations_reached': return 'hit iteration cap (no final answer)'
    case 'preview_ready': return `preview ${e.httpStatus} → ${e.url}`
    case 'sandbox_closed': return 'sandbox closed'
    case 'stream_error': return `error: ${String(e.message ?? '')}`
    default: return e.event
  }
}

export default function App() {
  const [prompt, setPrompt] = useState('build me a todo app')
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingQuestion | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [answer, setAnswer] = useState('')
  const [running, setRunning] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  function stop() {
    esRef.current?.close() // disconnect → server tears the sandbox down
    esRef.current = null
    setRunning(false)
    setSessionId(null)
    setPending(null)
  }

  function start() {
    stop()
    setEvents([]); setPreviewUrl(null); setRunning(true)
    const es = new EventSource(`${API}/agent/stream?prompt=${encodeURIComponent(prompt)}`)
    esRef.current = es
    es.onmessage = (msg) => {
      const e: AgentEvent = JSON.parse(msg.data)
      if (e.event === 'ping') return
      if (e.sessionId) setSessionId((prev) => prev ?? e.sessionId!)
      setEvents((prev) => [...prev, e])
      if (e.event === 'preview_ready' && typeof e.url === 'string') setPreviewUrl(e.url)
      if (e.event === 'ask_user' && e.callId && e.question != null) {
        setPending({ callId: e.callId, question: e.question, options: e.options ?? [] })
      }
    }
    es.onerror = () => stop()
  }

  function sendFollowUp() {
    if (!sessionId || !followUp.trim()) return
    fetch(`${API}/agent/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: followUp }),
    })
    setFollowUp('')
  }

  function submitAnswer(value: string) {
    if (!sessionId || !pending || !value.trim()) return
    fetch(`${API}/agent/${sessionId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: pending.callId, answer: value }),
    })
    setPending(null)
    setAnswer('')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', height: '100vh', font: '14px system-ui' }}>
      <aside style={{ borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 12, borderBottom: '1px solid #eee' }}>
          <h1 style={{ fontSize: 16, margin: '0 0 8px' }}>Orin</h1>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={running}
            style={{ width: '100%', boxSizing: 'border-box', font: 'inherit', padding: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={start} disabled={running || !prompt.trim()}>Build</button>
            <button onClick={stop} disabled={!running}>Stop</button>
          </div>
        </div>

        <ol style={{ margin: 0, padding: 12, overflowY: 'auto', flex: 1, listStyle: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          {events.map((e, i) => (
            <li key={i} style={{ padding: '3px 0', borderBottom: '1px solid #f2f2f2', whiteSpace: 'pre-wrap' }}>
              <span style={{ color: '#999' }}>{e.event}</span>  {describe(e)}
            </li>
          ))}
        </ol>

        {/* Composer: an ask_user question (options + free text) takes over when the
            agent is waiting; otherwise it's the follow-up prompt box. */}
        {sessionId && (
          <div style={{ borderTop: '1px solid #eee', padding: 12 }}>
            {pending ? (
              <div>
                <div style={{ marginBottom: 8, fontWeight: 600 }}>❓ {pending.question}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  {pending.options.map((opt) => (
                    <button key={opt} onClick={() => submitAnswer(opt)}>{opt}</button>
                  ))}
                </div>
                <form onSubmit={(ev) => { ev.preventDefault(); submitAnswer(answer) }} style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="or type your own answer…"
                    style={{ flex: 1, font: 'inherit', padding: 6 }}
                    autoFocus
                  />
                  <button type="submit" disabled={!answer.trim()}>Send</button>
                </form>
              </div>
            ) : (
              <form onSubmit={(ev) => { ev.preventDefault(); sendFollowUp() }} style={{ display: 'flex', gap: 8 }}>
                <input
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder="follow-up: e.g. add dark mode…"
                  style={{ flex: 1, font: 'inherit', padding: 6 }}
                />
                <button type="submit" disabled={!followUp.trim()}>Send</button>
              </form>
            )}
          </div>
        )}
      </aside>

      <main style={{ minWidth: 0 }}>
        {previewUrl ? (
          <iframe src={previewUrl} title="preview" style={{ width: '100%', height: '100%', border: 0 }} />
        ) : (
          <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#888' }}>
            {running ? 'building…' : 'Enter a prompt and hit Build'}
          </div>
        )}
      </main>
    </div>
  )
}
