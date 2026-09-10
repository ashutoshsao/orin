import { useEffect, useRef, useState } from 'react'
import { authClient } from './authClient'

const API = 'http://localhost:4000'

type Project = { id: string; name: string; createdAt: string }

// ─────────────────────────────────────────── App shell: auth gate → projects → builder
export default function App() {
  const { data: session, isPending } = authClient.useSession()
  const [active, setActive] = useState<{ project: Project; firstPrompt?: string } | null>(null)

  if (isPending) return <Centered>loading…</Centered>
  if (!session) return <AuthScreen />
  if (!active) return <ProjectsScreen onOpen={(project, firstPrompt) => setActive({ project, firstPrompt })} />
  return <Builder {...active} onBack={() => setActive(null)} />
}

// ─────────────────────────────────────────────────────────────────────── Sign in / up
function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = mode === 'in'
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name })
    setBusy(false)
    if (res.error) setError(res.error.message ?? 'Something went wrong')
  }

  return (
    <Centered>
      <form onSubmit={submit} style={{ display: 'grid', gap: 8, width: 300 }}>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Orin</h1>
        {mode === 'up' && (
          <input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        )}
        <input placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
        <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inp} />
        <button disabled={busy} type="submit">{mode === 'in' ? 'Sign in' : 'Sign up'}</button>
        {error && <div style={{ color: '#c00', fontSize: 13 }}>{error}</div>}
        <button type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null) }} style={linkBtn}>
          {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </form>
    </Centered>
  )
}

// ────────────────────────────────────────────────────────────────────── Projects list
function ProjectsScreen({ onOpen }: { onOpen: (p: Project, firstPrompt?: string) => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [prompt, setPrompt] = useState('build me a todo app')

  async function refresh() {
    const res = await fetch(`${API}/projects`, { credentials: 'include' })
    if (res.ok) setProjects(await res.json())
  }
  useEffect(() => { refresh() }, [])

  async function create() {
    const name = prompt.slice(0, 60) || 'Untitled'
    const res = await fetch(`${API}/projects`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) onOpen(await res.json(), prompt) // hand off to builder with the first prompt
  }

  return (
    <div style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20 }}>Your projects</h1>
        <button onClick={() => authClient.signOut()} style={linkBtn}>Sign out</button>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="describe an app to build…" style={{ ...inp, flex: 1 }} />
        <button onClick={create} disabled={!prompt.trim()}>New build</button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
        {projects.map((p) => (
          <li key={p.id}>
            <button onClick={() => onOpen(p)} style={{ width: '100%', textAlign: 'left', padding: 12, border: '1px solid #ddd', borderRadius: 8, background: '#fff', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ color: '#999', fontSize: 12 }}>{new Date(p.createdAt).toLocaleString()}</div>
            </button>
          </li>
        ))}
        {projects.length === 0 && <li style={{ color: '#999' }}>No projects yet — start a build above.</li>}
      </ul>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────── Builder
type AgentEvent = {
  event: string; sessionId?: string; iteration?: number; status?: string
  content?: unknown; url?: string; httpStatus?: string; callId?: string
  question?: string; options?: string[]; [k: string]: unknown
}
type Pending = { callId: string; question: string; options: string[] }

function describe(e: AgentEvent): string {
  switch (e.event) {
    case 'sandbox_created': return `sandbox up`
    case 'run_start': return `▶ ${String(e.userPrompt ?? '')}`
    case 'llm_call': return `llm call #${e.iteration} → ${e.status}`
    case 'tool_call': return `tools #${e.iteration}: ${(e.tools as { name: string; ok: boolean }[] ?? []).map(t => `${t.name}${t.ok ? '✓' : '✗'}`).join(' ')}`
    case 'ask_user': return `❓ ${String(e.question ?? '')}`
    case 'final': return `✓ ${String(e.content ?? '')}`
    case 'preview_ready': return `preview ${e.httpStatus}`
    case 'unauthorized': return 'not signed in'
    case 'project_not_found': return 'project not found'
    case 'stream_error': return `error: ${String(e.message ?? '')}`
    default: return e.event
  }
}

function Builder({ project, firstPrompt, onBack }: { project: Project; firstPrompt?: string; onBack: () => void }) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [answer, setAnswer] = useState('')
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const url = `${API}/agent/stream?projectId=${project.id}${firstPrompt ? `&prompt=${encodeURIComponent(firstPrompt)}` : ''}`
    const es = new EventSource(url, { withCredentials: true }) // sends the auth cookie
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
    es.onerror = () => { /* connection ended */ }
    return () => es.close() // leaving the builder disconnects → server tears the sandbox down
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id])

  function sendFollowUp() {
    if (!sessionId || !followUp.trim()) return
    fetch(`${API}/agent/${sessionId}/message`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: followUp }),
    })
    setFollowUp('')
  }
  function submitAnswer(value: string) {
    if (!sessionId || !pending || !value.trim()) return
    fetch(`${API}/agent/${sessionId}/answer`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: pending.callId, answer: value }),
    })
    setPending(null); setAnswer('')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '440px 1fr', height: '100vh', font: '14px system-ui' }}>
      <aside style={{ borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 12, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{project.name}</strong>
          <button onClick={onBack} style={linkBtn}>← projects</button>
        </div>
        <ol style={{ margin: 0, padding: 12, overflowY: 'auto', flex: 1, listStyle: 'none', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          {events.map((e, i) => (
            <li key={i} style={{ padding: '3px 0', borderBottom: '1px solid #f2f2f2', whiteSpace: 'pre-wrap' }}>
              <span style={{ color: '#999' }}>{e.event}</span>  {describe(e)}
            </li>
          ))}
        </ol>
        <div style={{ borderTop: '1px solid #eee', padding: 12 }}>
          {pending ? (
            <div>
              <div style={{ marginBottom: 8, fontWeight: 600 }}>❓ {pending.question}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {pending.options.map((opt) => <button key={opt} onClick={() => submitAnswer(opt)}>{opt}</button>)}
              </div>
              <form onSubmit={(ev) => { ev.preventDefault(); submitAnswer(answer) }} style={{ display: 'flex', gap: 8 }}>
                <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="or type your own…" style={{ ...inp, flex: 1 }} autoFocus />
                <button type="submit" disabled={!answer.trim()}>Send</button>
              </form>
            </div>
          ) : (
            <form onSubmit={(ev) => { ev.preventDefault(); sendFollowUp() }} style={{ display: 'flex', gap: 8 }}>
              <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="follow-up: e.g. add dark mode…" style={{ ...inp, flex: 1 }} />
              <button type="submit" disabled={!followUp.trim()}>Send</button>
            </form>
          )}
        </div>
      </aside>
      <main style={{ minWidth: 0 }}>
        {previewUrl
          ? <iframe src={previewUrl} title="preview" style={{ width: '100%', height: '100%', border: 0 }} />
          : <Centered>building…</Centered>}
      </main>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────── shared
const inp: React.CSSProperties = { font: 'inherit', padding: 8, border: '1px solid #ccc', borderRadius: 6 }
const linkBtn: React.CSSProperties = { border: 'none', background: 'none', color: '#06c', cursor: 'pointer', padding: 0, font: 'inherit' }

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: '#666', font: '14px system-ui' }}>{children}</div>
}
