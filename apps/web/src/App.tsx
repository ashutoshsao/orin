import { useRef, useState } from 'react'

const STREAM_URL = 'http://localhost:4000/agent/stream'

type AgentEvent = {
  event: string
  ts?: string
  iteration?: number
  status?: string
  content?: unknown
  url?: string
  httpStatus?: string
  message?: string
  [key: string]: unknown
}

// One-line summary per event type, so the log reads like a build feed.
function describe(e: AgentEvent): string {
  switch (e.event) {
    case 'sandbox_created': return `sandbox up (${e.sandboxId})`
    case 'run_start': return `prompt: ${String(e.userPrompt ?? '')}`
    case 'llm_call': return `llm call #${e.iteration} → ${e.status}`
    case 'tool_call': return `tools #${e.iteration}: ${(e.tools as { name: string; ok: boolean }[] ?? []).map(t => `${t.name}${t.ok ? '✓' : '✗'}`).join(' ')}`
    case 'final': return `done: ${String(e.content ?? '')}`
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
  const [running, setRunning] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  function stop() {
    esRef.current?.close() // closing the EventSource disconnects → server tears the sandbox down
    esRef.current = null
    setRunning(false)
  }

  function start() {
    stop()
    setEvents([])
    setPreviewUrl(null)
    setRunning(true)

    const es = new EventSource(`${STREAM_URL}?prompt=${encodeURIComponent(prompt)}`)
    esRef.current = es
    es.onmessage = (msg) => {
      const e: AgentEvent = JSON.parse(msg.data)
      if (e.event === 'ping') return // heartbeat, not worth showing
      setEvents((prev) => [...prev, e])
      if (e.event === 'preview_ready' && typeof e.url === 'string') setPreviewUrl(e.url)
    }
    es.onerror = () => {
      // stream ended or errored; EventSource would auto-reconnect, so close it
      stop()
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', height: '100vh', font: '14px system-ui' }}>
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
