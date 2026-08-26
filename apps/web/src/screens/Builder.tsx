import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUp, History, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { API, getJSON, historyToEvents, postJSON, timeAgo, type AgentEvent, type Pending, type Project, type Snap, type StoredMessage } from '@/lib/api'
import { activityLine, errorText, eventKind } from '@/lib/events'
import { Markdown } from '@/components/markdown'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function Builder({ project, firstPrompt, onBack }: { project: Project; firstPrompt?: string; onBack: () => void }) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [followUp, setFollowUp] = useState('')
  const [answer, setAnswer] = useState('')
  const [snapshots, setSnapshots] = useState<Snap[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [confirmSnap, setConfirmSnap] = useState<Snap | null>(null)
  // Bumped after a rewind to reopen the project at the rewound state. The first prompt
  // only applies to the very first mount.
  const [reloadKey, setReloadKey] = useState(0)
  const esRef = useRef<EventSource | null>(null)
  const feedEndRef = useRef<HTMLDivElement | null>(null)
  const effectivePrompt = reloadKey === 0 ? firstPrompt : undefined
  const running = events.length > 0 && !events.some((e) => e.event === 'final') && !pending

  const refreshSnapshots = () => {
    getJSON<Snap[]>(`/projects/${project.id}/snapshots`, []).then(setSnapshots)
  }
  useEffect(refreshSnapshots, [project.id, reloadKey])

  // Replay the persisted transcript on open (nothing for a brand-new project).
  useEffect(() => {
    if (effectivePrompt) return
    let alive = true
    getJSON<StoredMessage[]>(`/projects/${project.id}/messages`, []).then((messages) => {
      const history = historyToEvents(messages)
      if (alive && history.length) setEvents((prev) => [...history, ...prev])
    })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, reloadKey])

  useEffect(() => {
    const url = `${API}/agent/stream?projectId=${project.id}${effectivePrompt ? `&prompt=${encodeURIComponent(effectivePrompt)}` : ''}`
    const es = new EventSource(url, { withCredentials: true }) // carries the auth cookie
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
      if (e.event === 'final') refreshSnapshots() // a run finished — new rewind points
    }
    return () => es.close() // leaving disconnects → the server tears the sandbox down
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, reloadKey])

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events.length])

  function sendFollowUp(e: React.FormEvent) {
    e.preventDefault()
    if (!sessionId || !followUp.trim()) return
    setEvents((prev) => [...prev, { event: 'run_start', userPrompt: followUp }]) // optimistic
    postJSON(`/agent/${sessionId}/message`, { prompt: followUp })
    setFollowUp('')
  }

  function submitAnswer(value: string) {
    if (!sessionId || !pending || !value.trim()) return
    postJSON(`/agent/${sessionId}/answer`, { callId: pending.callId, answer: value })
    setPending(null); setAnswer('')
  }

  // Roll back to a snapshot, then reopen there: the server truncates the conversation
  // past that point and repoints the codebase, so the fresh session restores older files.
  async function rewindTo(snap: Snap) {
    setConfirmSnap(null)
    const res = await postJSON(`/projects/${project.id}/rewind`, { snapshotId: snap.id })
    if (!res.ok) { toast.error('Could not rewind to that point.'); return }
    esRef.current?.close()
    setEvents([]); setPreviewUrl(null); setSessionId(null); setPending(null); setShowHistory(false)
    setReloadKey((k) => k + 1)
    toast.success('Rewound', { description: 'Restoring the code and conversation from that point.' })
  }

  return (
    <div className="grid h-dvh grid-cols-1 bg-background md:grid-cols-[minmax(360px,420px)_1fr]">
      <aside className="flex min-h-0 flex-col border-r">
        <header className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to projects">
              <ArrowLeft />
            </Button>
            <span className="truncate text-sm font-medium">{project.name}</span>
          </div>
          {snapshots.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              <History /> {snapshots.length}
            </Button>
          )}
        </header>
        <Separator />

        <AnimatePresence initial={false}>
        {showHistory && (
          <motion.div
            key="history"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden border-b bg-muted/30"
          >
          <div className="px-4 py-3">
            <p className="text-xs text-muted-foreground">
              Rewind to an earlier point. Work after it is discarded.
            </p>
            <ul className="mt-2.5 space-y-1">
              {snapshots.map((snap, i) => {
                const current = i === snapshots.length - 1
                return (
                  <li key={snap.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground">
                      <span className="font-mono">{snap.commitHash.slice(0, 7)}</span>
                      <span className="mx-1.5">·</span>
                      {timeAgo(snap.createdAt)}
                    </span>
                    {current
                      ? <span className="shrink-0 text-muted-foreground">current</span>
                      : <Button variant="ghost" size="sm" onClick={() => setConfirmSnap(snap)}>Rewind</Button>}
                  </li>
                )
              })}
            </ul>
          </div>
          </motion.div>
        )}
        </AnimatePresence>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 px-4 py-4">
            {events.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Waking up the environment…</p>
            )}
            {events.map((e, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                <FeedRow event={e} onAnswer={submitAnswer} />
              </motion.div>
            ))}
            {running && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> working…
              </p>
            )}
            <div ref={feedEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t p-3">
          {pending ? (
            <div className="space-y-2.5">
              <p className="text-sm font-medium">{pending.question}</p>
              {pending.options.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {pending.options.map((opt) => (
                    <Button key={opt} variant="outline" size="sm" onClick={() => submitAnswer(opt)}>{opt}</Button>
                  ))}
                </div>
              )}
              <form onSubmit={(ev) => { ev.preventDefault(); submitAnswer(answer) }} className="flex gap-2">
                <input
                  value={answer}
                  onChange={(ev) => setAnswer(ev.target.value)}
                  placeholder="Or say it in your own words…"
                  autoFocus
                  className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
                />
                <Button type="submit" size="sm" disabled={!answer.trim()}>Send</Button>
              </form>
            </div>
          ) : (
            <form onSubmit={sendFollowUp} className="flex gap-2">
              <input
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder={sessionId ? 'Add dark mode…' : 'Connecting…'}
                disabled={!sessionId}
                className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring disabled:opacity-60"
              />
              <Button type="submit" size="icon" disabled={!followUp.trim() || !sessionId} aria-label="Send">
                <ArrowUp />
              </Button>
            </form>
          )}
        </div>
      </aside>

      <main className="hidden min-w-0 p-3 md:block">
        {previewUrl ? (
          <motion.iframe
            src={previewUrl}
            title="App preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="h-full w-full rounded-xl border bg-white"
          />
        ) : (
          <div className="grid h-full place-items-center rounded-xl border bg-muted/20">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Building your app…
            </div>
          </div>
        )}
      </main>

      <AlertDialog open={confirmSnap !== null} onOpenChange={(open) => !open && setConfirmSnap(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rewind to this point?</AlertDialogTitle>
            <AlertDialogDescription>
              The code and conversation after this snapshot are permanently discarded.
              The project reopens with the files as they were.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmSnap && rewindTo(confirmSnap)}>Rewind</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// One feed entry. The conversation reads as prose; telemetry stays a thin muted line.
function FeedRow({ event, onAnswer }: { event: AgentEvent; onAnswer: (v: string) => void }) {
  const kind = eventKind(event)

  if (kind === 'user') {
    return (
      <div className="rounded-lg bg-muted px-3 py-2 text-sm">
        {String(event.userPrompt ?? '')}
      </div>
    )
  }
  if (kind === 'assistant') {
    return <Markdown>{String(event.content ?? '')}</Markdown>
  }
  if (kind === 'question') {
    return (
      <div className="rounded-lg border border-dashed px-3 py-2 text-sm">
        {String(event.question ?? '')}
        {Array.isArray(event.options) && event.options.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {event.options.map((o) => (
              <Button key={o} variant="outline" size="sm" onClick={() => onAnswer(o)}>{o}</Button>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (kind === 'error') {
    return <p className="text-xs text-destructive">{errorText(event)}</p>
  }

  const { label, detail } = activityLine(event)
  return (
    <p className="flex gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">{label}</span>
      {detail && <span className="truncate opacity-70">{detail}</span>}
    </p>
  )
}
