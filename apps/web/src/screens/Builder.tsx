import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleAlert, ExternalLink, History, Loader2, PlugZap, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'motion/react'
import { API, clockTime, getJSON, historyToEvents, postJSON, timeAgo, type AgentEvent, type Pending, type Project, type Snap, type StoredMessage } from '@/lib/api'
import { activityLine, appTrouble, errorText, eventKind, groupFeed, runStatus, summarizeActivity } from '@/lib/events'
import { Markdown } from '@/components/markdown'
import { PreviewTrouble } from '@/components/PreviewTrouble'
import { BuilderSheet } from '@/components/BuilderSheet'
import { Kbd } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ThemeToggle } from '@/components/theme-toggle'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { stepsLeftLabel, type Access } from '@/lib/access'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function Builder({ project, firstPrompt, access, onAccessChange, onBack }: {
  project: Project
  firstPrompt?: string
  access: Access
  // Re-read access (steps left / expiry) after something that may have changed it.
  onAccessChange: () => void
  onBack: () => void
}) {
  const outOfSteps = access.stepsLeft === 0
  const stepsLabel = stepsLeftLabel(access)
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
  // Bumped by the preview bar's refresh button to reload just the iframe.
  const [frameKey, setFrameKey] = useState(0)
  // The stream dying used to be invisible — the UI just sat there looking busy.
  const [connection, setConnection] = useState<'open' | 'reconnecting' | 'closed'>('open')
  // Set when the server closed the session on purpose (another project opened, a rewind in
  // another tab) — then we stop instead of auto-reconnecting, and say why.
  const [closedReason, setClosedReason] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const feedEndRef = useRef<HTMLDivElement | null>(null)
  // Consecutive failed connection attempts, for reconnect backoff.
  const retriesRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Resume: the last SSE event id we received, and whether the next connection is a
  // reconnect (keep what's on screen, ask for what we missed) rather than a fresh open.
  const lastIdRef = useRef('')
  const resumingRef = useRef(false)
  // Bumped to reconnect the stream *without* resetting the view (unlike reloadKey).
  const [connKey, setConnKey] = useState(0)
  const effectivePrompt = reloadKey === 0 ? firstPrompt : undefined
  const status = runStatus(events, { pending: pending !== null, hasPreview: previewUrl !== null, online: connection === 'open' })
  const trouble = appTrouble(events)
  // Matches Tailwind's `md`, which is where the two-column layout starts being usable.
  const isDesktop = useMediaQuery('(min-width: 768px)')

  const refreshSnapshots = () => {
    getJSON<Snap[]>(`/projects/${project.id}/snapshots`, []).then(setSnapshots)
  }
  useEffect(refreshSnapshots, [project.id, reloadKey])

  // Load the persisted transcript and put it ahead of whatever live events have arrived.
  function loadHistory(isAlive: () => boolean = () => true) {
    getJSON<StoredMessage[]>(`/projects/${project.id}/messages`, []).then((messages) => {
      const history = historyToEvents(messages)
      if (isAlive() && history.length) setEvents((prev) => [...history, ...prev])
    })
  }

  // Replay the persisted transcript on open (nothing for a brand-new project).
  useEffect(() => {
    if (effectivePrompt) return
    let alive = true
    loadHistory(() => alive)
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, reloadKey])

  // Try the stream again without touching what's on screen: the server keeps the session
  // running for a grace period, and replays exactly the events we missed.
  function reconnect() {
    esRef.current?.close()
    resumingRef.current = true
    setConnKey((k) => k + 1)
  }

  useEffect(() => {
    const params = new URLSearchParams({ projectId: project.id })
    // The first prompt goes out only on a genuinely fresh open — never on a reconnect.
    if (effectivePrompt && !resumingRef.current) params.set('prompt', effectivePrompt)
    if (resumingRef.current && lastIdRef.current) params.set('after', lastIdRef.current)
    const es = new EventSource(`${API}/agent/stream?${params}`, { withCredentials: true }) // carries the auth cookie
    esRef.current = es
    es.onopen = () => { retriesRef.current = 0; setConnection('open'); setClosedReason(null) }
    // Never let EventSource reconnect by itself: its retry reuses this URL (first prompt
    // included) and knows nothing of resume. Close it and reconnect ourselves with the last
    // event id, backing off; after a few failures, stop and offer the Reconnect button.
    es.onerror = () => {
      // Diagnostic: dropped streams have killed builds and the cause is still unknown.
      console.warn('[orin] stream error', { at: new Date().toISOString(), readyState: es.readyState, lastEventId: lastIdRef.current })
      es.close()
      const attempt = retriesRef.current++
      if (attempt >= 4) { setConnection('closed'); return }
      setConnection('reconnecting')
      retryTimerRef.current = setTimeout(reconnect, Math.min(1000 * 2 ** attempt, 8000))
    }
    es.onmessage = (msg) => {
      if (msg.lastEventId) lastIdRef.current = msg.lastEventId
      const e: AgentEvent = JSON.parse(msg.data)
      if (e.event === 'ping') return
      // Spent a step, ran out, or lost access: re-read it (the last two flip the screen/composer).
      if (e.event === 'llm_call' || e.event === 'budget_exhausted' || e.event === 'access_expired' || e.event === 'no_access') onAccessChange()
      if (e.event === 'session_closed') {
        // Don't reconnect on our own: for a limited account that would reopen this project
        // and close the other tab's — two tabs closing each other forever. Wait for a click.
        es.close()
        setConnection('closed')
        setClosedReason(typeof e.reason === 'string' ? e.reason : 'closed')
        return
      }
      if (e.event === 'attached') {
        // A reconnect that didn't rejoin (the grace period ran out): what's on screen
        // belongs to a session that no longer exists — reset and reload from the database.
        if (resumingRef.current && !e.resumed) {
          setEvents([]); setPreviewUrl(null); setSessionId(null); setPending(null)
          loadHistory()
        }
        resumingRef.current = false
        return
      }
      if (e.sessionId) setSessionId((prev) => prev ?? e.sessionId!)
      setEvents((prev) => {
        // A follow-up is shown optimistically the moment it's sent; when the server echoes
        // it as run_start, swap our local copy for the real event instead of appending a
        // second bubble.
        if (e.event === 'run_start') {
          const i = prev.findLastIndex((p) => p.local && p.userPrompt === e.userPrompt)
          if (i !== -1) return prev.map((p, j) => (j === i ? e : p))
        }
        return [...prev, e]
      })
      // Also on `preview_unreachable`: the probe gave up, but the server may still be coming
      // up — showing the frame (and the reload button) beats showing nothing forever.
      if ((e.event === 'preview_ready' || e.event === 'preview_unreachable') && typeof e.url === 'string') {
        setPreviewUrl(e.url)
      }
      if (e.event === 'ask_user' && e.callId && e.question != null) {
        setPending({ callId: e.callId, question: e.question, options: e.options ?? [] })
      }
      if (e.event === 'final') refreshSnapshots() // a run finished — new rewind points
    }
    return () => {
      es.close() // leaving detaches; the server keeps the session for a grace period
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, reloadKey, connKey])

  useEffect(() => { feedEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events.length])

  // One path for every follow-up — the composer and the step-limit "Continue" button alike.
  function send(text: string) {
    if (!sessionId || !text.trim() || outOfSteps) return
    setEvents((prev) => [...prev, { event: 'run_start', userPrompt: text, ts: new Date().toISOString(), local: true }])
    postJSON(`/agent/${sessionId}/message`, { prompt: text })
  }

  function sendFollowUp(e: React.FormEvent) {
    e.preventDefault()
    if (!followUp.trim()) return
    send(followUp.trim())
    setFollowUp('')
  }

  function submitAnswer(value: string) {
    if (!sessionId || !pending || !value.trim()) return
    postJSON(`/agent/${sessionId}/answer`, { callId: pending.callId, answer: value })
    setPending(null); setAnswer('')
  }

  // Reopen the project on a fresh session. Everything on screen belongs to the old
  // session — a parked ask_user (whose callId dies with it), the transcript we're about
  // to re-fetch, the preview URL of a torn-down sandbox — so all of it is cleared.
  function reopen() {
    esRef.current?.close()
    resumingRef.current = false
    lastIdRef.current = ''
    setEvents([]); setPreviewUrl(null); setSessionId(null); setPending(null); setShowHistory(false)
    setReloadKey((k) => k + 1)
  }

  // Roll back to a snapshot, then reopen there: the server truncates the conversation
  // past that point and repoints the codebase, so the fresh session restores older files.
  async function rewindTo(snap: Snap) {
    setConfirmSnap(null)
    const res = await postJSON(`/projects/${project.id}/rewind`, { snapshotId: snap.id })
    if (!res.ok) { toast.error('Could not rewind to that point.'); return }
    reopen()
    toast.success('Rewound', { description: 'Restoring the code and conversation from that point.' })
  }

  const [statusHead, ...statusRest] = status.label.split(' · ')
  const feed = groupFeed(events)
  const lastMessageAt = feed.findLastIndex((item) => item.type === 'message')

  // Panes are element trees, not nested components: a nested function component would be a new
  // type on every render and remount the whole feed. The chat is built once and placed either
  // in the desktop column or in the mobile sheet, so its scroll position and refs survive.
  // Split in two because the mobile sheet reverses them: at its peek height only the TOP of
  // the sheet is on screen, so the composer — the one thing a phone user needs — has to sit
  // there, with the conversation above it once the sheet is dragged up.
  const chatFeed = (
    <>
          <header className="flex items-center justify-between gap-3 px-4 pt-5 pb-4">
            <div className="flex min-w-0 items-center gap-1.5">
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" onClick={onBack} aria-label="Back to projects">
                <ChevronLeft />
              </Button>
              <span className="truncate font-display text-[22px] leading-none tracking-[-0.01em]">{project.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {snapshots.length > 0 && (
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  aria-expanded={showHistory}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground aria-expanded:text-foreground"
                >
                  <History className="size-3.5" />
                  {snapshots.length} {snapshots.length === 1 ? 'snapshot' : 'snapshots'}
                </button>
              )}
              <ThemeToggle />
            </div>
          </header>

          <AnimatePresence initial={false}>
            {showHistory && (
              <motion.div
                key="history"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden border-y bg-card/60"
              >
                <div className="px-6 py-3">
                  <p className="text-xs text-muted-foreground">Rewind to an earlier point. Work after it is discarded.</p>
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
                            : <Button variant="ghost" size="xs" onClick={() => setConfirmSnap(snap)}>Rewind</Button>}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-[22px] px-6 pt-2.5 pb-6">
              {events.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Waking up the environment…</p>
              )}
              {feed.map((item, i, all) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  {item.type === 'message' ? (
                    <FeedRow
                      event={item.event}
                      onAnswer={submitAnswer}
                      // Offer Continue only on the latest message, and only when nothing's running.
                      onContinue={i === lastMessageAt && !status.building && sessionId ? () => send('continue') : undefined}
                    />
                  )
                    : item.type === 'divider' ? <SessionDivider ts={item.event.ts} />
                    : <ActivityGroup events={item.events} working={i === all.length - 1 && status.building} />}
                </motion.div>
              ))}
              <div ref={feedEndRef} />
            </div>
          </ScrollArea>
    </>
  )

  const chatComposer = (
    <>

          {connection !== 'open' && (
            <div className="flex items-center justify-between gap-2 border-t bg-muted/40 px-6 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <PlugZap className="size-3.5" />
                {connection === 'reconnecting'
                  ? 'Reconnecting…'
                  : closedReason === 'other_project'
                    ? 'Paused — you opened another project'
                    : closedReason === 'rewind'
                      ? 'Rewound elsewhere — reopen to continue'
                      : 'Disconnected'}
              </span>
              {connection === 'closed' && (
                <Button variant="ghost" size="xs" onClick={() => { retriesRef.current = 0; if (closedReason) reopen(); else reconnect() }}>
                  {closedReason ? 'Reopen' : 'Reconnect'}
                </Button>
              )}
            </div>
          )}

          <div className="px-5 pt-3 pb-5">
            {pending ? (
              <div className="space-y-3 rounded-2xl border bg-card p-4">
                <p className="text-[15px] font-medium">{pending.question}</p>
                {pending.options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pending.options.map((opt) => (
                      <Button key={opt} variant="outline" size="sm" className="rounded-lg" onClick={() => submitAnswer(opt)}>{opt}</Button>
                    ))}
                  </div>
                )}
                <form onSubmit={(ev) => { ev.preventDefault(); submitAnswer(answer) }} className="flex items-center gap-2.5">
                  <input
                    value={answer}
                    onChange={(ev) => setAnswer(ev.target.value)}
                    placeholder="Or say it in your own words…"
                    autoFocus
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80"
                  />
                  <Kbd>↵</Kbd>
                  <Button type="submit" size="sm" className="rounded-lg px-3 font-semibold" disabled={!answer.trim()}>Send</Button>
                </form>
              </div>
            ) : (
              <form
                onSubmit={sendFollowUp}
                className="flex items-center gap-2.5 rounded-2xl border bg-card py-2 pr-2 pl-4 shadow-[0_10px_28px_-18px_rgb(60_40_20/0.3)] transition-colors focus-within:border-ring dark:shadow-none"
              >
                <input
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder={outOfSteps ? 'No steps left in this trial' : sessionId ? 'Ask for a change…' : 'Connecting…'}
                  disabled={!sessionId || outOfSteps}
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80 disabled:opacity-60"
                />
                <Kbd>↵</Kbd>
                <Button type="submit" size="sm" className="rounded-lg px-3 font-semibold" disabled={!followUp.trim() || !sessionId || outOfSteps}>
                  Send
                </Button>
              </form>
            )}
            {stepsLabel && (
              <p className="mt-2 px-1 font-mono text-[11px] text-muted-foreground">
                {outOfSteps ? 'Trial used up · your work is saved' : `Trial · ${stepsLabel}`}
              </p>
            )}
          </div>
    </>
  )

  const previewPane = (
    <>
        {/* The preview sits like a sheet on the desk; the generated app keeps its own white. */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-[18px] border bg-card shadow-[0_1px_0_rgb(28_24_20/0.04),0_30px_60px_-30px_rgb(60_40_20/0.35)] dark:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)]">
          <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className={cn('size-1.5 rounded-full bg-primary', status.active && 'animate-pulse shadow-[0_0_0_4px] shadow-primary/20')} />
              <span className="text-foreground/80">{statusHead}</span>
              {statusRest.length > 0 && <span className="text-muted-foreground">· {statusRest.join(' · ')}</span>}
            </div>
            <div className="flex items-center gap-0.5 text-muted-foreground">
              <Button variant="ghost" size="icon-sm" disabled={!previewUrl} onClick={() => setFrameKey((k) => k + 1)} aria-label="Reload preview">
                <RotateCw />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={!previewUrl} onClick={() => previewUrl && window.open(previewUrl, '_blank', 'noopener')} aria-label="Open preview in a new tab">
                <ExternalLink />
              </Button>
            </div>
          </div>

          <div className="relative flex-1 bg-white">
            {previewUrl ? (
              <>
                <motion.iframe
                  key={frameKey}
                  src={previewUrl}
                  title="App preview"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, ease: 'easeOut' }}
                  className="absolute inset-0 h-full w-full"
                />
                {/* Sits over the iframe, so Vite's error screen is never what the user reads. */}
                <AnimatePresence>
                  {trouble && <PreviewTrouble key={trouble} state={trouble} />}
                </AnimatePresence>
              </>
            ) : (
              <div className="grid h-full place-items-center bg-card">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Building your app…
                </div>
              </div>
            )}
          </div>
        </div>
    </>
  )

  const rewindDialog = (
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
  )

  // Phone: the preview IS the screen, with the chat as a drag-up sheet. Below `md` the preview
  // used to be hidden entirely — and a guest link opened on a phone is the recruiter path, so
  // watching the app get built is the whole point of being there (spec 9).
  if (!isDesktop) {
    return (
      <div className="flex h-dvh flex-col bg-background">
        <main className="flex min-h-0 flex-1 p-3">{previewPane}</main>
        <BuilderSheet status={status} composer={chatComposer}>{chatFeed}</BuilderSheet>
        {rewindDialog}
      </div>
    )
  }

  return (
    <div className="grid h-dvh grid-cols-1 bg-background md:grid-cols-[440px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col md:border-r">{chatFeed}{chatComposer}</aside>
      <main className="hidden min-w-0 p-5 md:flex">{previewPane}</main>
      {rewindDialog}
    </div>
  )
}


// A row with the chat gutter's clock on the left. Conversation rows get a time;
// telemetry sits under the same column without one.
function Timed({ ts, children, bubble }: { ts: unknown; children: React.ReactNode; bubble?: boolean }) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-start">
      <span className={cn('font-mono text-[11px] text-muted-foreground/70', bubble ? 'pt-3' : 'pt-1')}>{clockTime(ts)}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// A run of telemetry between two bits of conversation. The group currently being worked
// on reads "● working" and stays open; finished groups collapse to one summary line.
function ActivityGroup({ events, working }: { events: AgentEvent[]; working: boolean }) {
  const [open, setOpen] = useState(working)
  useEffect(() => { if (working) setOpen(true) }, [working])

  if (events.length === 1 && !working) {
    return <div className="pl-11"><ActivityRow event={events[0]} /></div>
  }

  return (
    <div className="pl-11">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-expanded={open}
      >
        {working
          ? <span className="size-[7px] animate-pulse rounded-full bg-primary shadow-[0_0_0_4px] shadow-primary/20" />
          : <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />}
        {working && <span className="text-foreground">working</span>}
        <span className={cn(working && 'text-muted-foreground/80')}>{working ? `· ${summarizeActivity(events)}` : summarizeActivity(events)}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2 ml-[3px] space-y-1.5 border-l pl-3.5">
              {events.map((e, i) => <ActivityRow key={i} event={e} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ActivityRow({ event }: { event: AgentEvent }) {
  const { label, detail } = activityLine(event)
  return (
    <p className="flex gap-2.5 font-mono text-xs text-muted-foreground">
      <span className="shrink-0 opacity-70">{label}</span>
      {detail && <span className="truncate">{detail}</span>}
    </p>
  )
}

// One conversation entry. Your prompts sit right as paper notes; the agent's answer reads
// as prose; a question gets a dashed card with its options.
function FeedRow({ event, onAnswer, onContinue }: { event: AgentEvent; onAnswer: (v: string) => void; onContinue?: () => void }) {
  const kind = eventKind(event)
  const continueButton = onContinue && (
    <Button variant="outline" size="sm" className="mt-2.5 rounded-lg" onClick={onContinue}>Continue</Button>
  )

  if (kind === 'limit' || kind === 'budget') {
    return (
      <Timed ts={event.ts}>
        <div className="rounded-xl border border-dashed px-3.5 py-2.5">
          <p className="flex gap-2 text-[15px] leading-relaxed">
            <CircleAlert className="mt-1 size-3.5 shrink-0 text-primary" />
            <span>{String(event.content ?? '')}</span>
          </p>
          {kind === 'limit' && continueButton}
        </div>
      </Timed>
    )
  }

  if (kind === 'user') {
    return (
      <Timed ts={event.ts} bubble>
        <div className="ml-auto w-fit max-w-[300px] rounded-[16px_16px_4px_16px] border bg-card px-[15px] py-[11px] text-[15px] leading-normal">
          {String(event.userPrompt ?? '')}
        </div>
      </Timed>
    )
  }
  if (kind === 'assistant') {
    return (
      <Timed ts={event.ts}>
        <Markdown className="text-[15px] text-foreground/85">{String(event.content ?? '')}</Markdown>
      </Timed>
    )
  }
  if (kind === 'question') {
    return (
      <Timed ts={event.ts}>
        <div className="rounded-xl border border-dashed px-3.5 py-2.5 text-[15px]">
          {String(event.question ?? '')}
          {Array.isArray(event.options) && event.options.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {event.options.map((o) => (
                <Button key={o} variant="outline" size="sm" className="rounded-lg" onClick={() => onAnswer(o)}>{o}</Button>
              ))}
            </div>
          )}
        </div>
      </Timed>
    )
  }
  if (kind === 'notice') {
    return (
      <Timed ts={event.ts}>
        <p className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This task was interrupted before it finished, so the preview may show a half-done
            change. Ask me to continue, or to fix what's broken.
          </span>
        </p>
        {continueButton && <div className="pl-5.5">{continueButton}</div>}
      </Timed>
    )
  }
  if (kind === 'error') {
    return <p className="pl-11 text-xs text-destructive">{errorText(event)}</p>
  }

  return <div className="pl-11"><ActivityRow event={event} /></div>
}

// Where a reopen starts a fresh session: a hairline with the time, so what follows reads
// as a new sitting rather than the tail of the previous run.
function SessionDivider({ ts }: { ts: unknown }) {
  const time = clockTime(ts)
  return (
    <div className="flex items-center gap-3 py-1 font-mono text-[11px] text-muted-foreground/70">
      <span className="h-px flex-1 bg-border" />
      <span>reopened{time && ` · ${time}`}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
