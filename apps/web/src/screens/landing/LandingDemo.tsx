import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { ChevronLeft, ChevronRight, ExternalLink, History, RotateCw } from 'lucide-react'
import { activityLine, appTrouble, groupFeed, runStatus, summarizeActivity } from '@/lib/events'
import { clockTime, type AgentEvent } from '@/lib/api'
import { PreviewTrouble } from '@/components/PreviewTrouble'
import { DotField } from '@/components/DotField'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { MalabarApp, type MalabarPart } from './MalabarApp'

// The landing page's showpiece: Orin building an app, played from a script.
//
// It doesn't imitate the product's feed — it IS the product's feed logic. The script emits real
// AgentEvents and everything shown is derived from them by the same functions the builder uses
// (groupFeed, activityLine, summarizeActivity, runStatus, appTrouble), so a label changed in the
// app changes here too, and the demo can't advertise something Orin doesn't do.
const PROMPT = 'build a landing page for my spice shop in Kerala — pepper, cardamom, turmeric'
const ANSWER = 'Your spice shop page is live — a hero with the harvest story, a product grid for pepper, cardamom and turmeric, and a footer with shipping details.'

// One entry per agent round, as the real loop logs it: thinking → $ command → snapshot.
const ROUNDS: { cmd: string; ms: number; parts?: MalabarPart[]; icons?: boolean; breaks?: boolean; repairs?: boolean; snap: string }[] = [
  { cmd: "cat > src/App.tsx <<'EOF'", ms: 900, parts: ['nav'], snap: '3f9a2c1' },
  { cmd: 'bun add lucide-react', ms: 1200, icons: true, snap: '8b1e04d' },
  { cmd: "cat > src/components/Hero.tsx <<'EOF'", ms: 900, parts: ['hero', 'art'], snap: 'c27d9f3' },
  { cmd: "cat > src/components/Products.tsx <<'EOF'", ms: 900, parts: ['c1', 'c2', 'c3'], breaks: true, snap: '1a6e8b2' },
  { cmd: "sed -i 's/price.toFixed(2)/price.toLocaleString()/' src/components/Products.tsx", ms: 800, repairs: true, snap: '9d04e7a' },
  { cmd: "cat > src/components/Footer.tsx <<'EOF'", ms: 750, parts: ['foot'], snap: 'e5b21c8' },
]
const TRIAL_STEPS = 60
const ALL_PARTS: MalabarPart[] = ['nav', 'hero', 'art', 'c1', 'c2', 'c3', 'foot']

const live = (e: AgentEvent): AgentEvent => ({ ...e, sessionId: 'demo', ts: new Date().toISOString() })

// The finished build, for reduced motion: same events, no playback.
function finished(): AgentEvent[] {
  const out: AgentEvent[] = [{ event: 'run_start', userPrompt: PROMPT }]
  ROUNDS.forEach((r, i) => {
    out.push({ event: 'llm_call', iteration: i + 1, status: 'toolCall' }, { event: 'tool_call', iteration: i + 1, tools: [{ name: 'bash', ok: true, command: r.cmd }] })
    if (r.breaks) out.push({ event: 'preview_error' }, { event: 'preview_repairing' })
    if (r.repairs) out.push({ event: 'preview_recovered' })
    out.push({ event: 'snapshot', commit: r.snap })
  })
  out.push({ event: 'final', content: ANSWER })
  return out.map(live)
}

export function LandingDemo() {
  const reduced = useReducedMotion()
  const desktop = useMediaQuery('(min-width: 768px)')
  const rootRef = useRef<HTMLDivElement>(null)
  const inView = useInView(rootRef, { amount: 0.45, once: true })
  const [started, setStarted] = useState(false)

  const [events, setEvents] = useState<AgentEvent[]>([])
  const [typed, setTyped] = useState<string | null>(null)   // null = composer idle
  const [pressed, setPressed] = useState(false)
  const [parts, setParts] = useState<ReadonlySet<MalabarPart>>(new Set())
  const [icons, setIcons] = useState(false)
  const [previewUp, setPreviewUp] = useState(false)

  // Start when it's actually seen. The fallback is insurance: an observer that never fires must
  // not leave the demo frozen (the idle window is visible either way).
  useEffect(() => { if (inView) setStarted(true) }, [inView])
  useEffect(() => { const t = setTimeout(() => setStarted(true), 9000); return () => clearTimeout(t) }, [])

  useEffect(() => {
    if (!started) return
    if (reduced) {
      setEvents(finished()); setParts(new Set(ALL_PARTS)); setIcons(true); setPreviewUp(true); setTyped(null)
      return
    }
    let alive = true
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const emit = (e: AgentEvent) => setEvents((prev) => [...prev, live(e)])

    async function play() {
      while (alive) {
        setEvents([]); setParts(new Set()); setIcons(false); setPreviewUp(false); setTyped(null)
        await sleep(700); if (!alive) return

        // 1. the prompt is typed and sent
        for (let i = 1; i <= PROMPT.length; i++) {
          setTyped(PROMPT.slice(0, i))
          await sleep(PROMPT[i - 1] === ' ' ? 45 : 27); if (!alive) return
        }
        await sleep(380); setPressed(true); await sleep(120); setPressed(false)
        setTyped(null); emit({ event: 'run_start', userPrompt: PROMPT })

        // 2. one round at a time; each file that lands changes the preview
        for (const [i, r] of ROUNDS.entries()) {
          await sleep(780); if (!alive) return
          emit({ event: 'llm_call', iteration: i + 1, status: 'toolCall' })
          emit({ event: 'tool_call', iteration: i + 1, tools: [{ name: 'bash', ok: true, command: r.cmd }] })
          await sleep(r.ms); if (!alive) return
          if (r.parts) {
            setPreviewUp(true)
            for (const p of r.parts) { setParts((prev) => new Set([...prev, p])); await sleep(140) }
          }
          if (r.icons) setIcons(true)
          if (r.breaks) { await sleep(450); emit({ event: 'preview_error' }); await sleep(750); emit({ event: 'preview_repairing' }) }
          if (r.repairs) { await sleep(150); emit({ event: 'preview_recovered' }) }
          await sleep(220); emit({ event: 'snapshot', commit: r.snap })
        }

        // 3. the answer arrives word by word, and the group folds away
        emit({ event: 'final', content: '' })
        const words = ANSWER.split(' ')
        for (let i = 1; i <= words.length; i++) {
          const content = words.slice(0, i).join(' ')
          setEvents((prev) => prev.map((e, j) => (j === prev.length - 1 ? { ...e, content } : e)))
          await sleep(36); if (!alive) return
        }
        await sleep(5200)
      }
    }
    play()
    return () => { alive = false }
  }, [started, reduced])

  const status = runStatus(events, { pending: false, hasPreview: previewUp, online: true })
  const trouble = appTrouble(events)
  const steps = events.filter((e) => e.event === 'llm_call').length
  const snaps = events.filter((e) => e.event === 'snapshot').length
  const view = { events, typed, pressed, parts, icons, previewUp, status, trouble, left: TRIAL_STEPS - steps, snaps }

  return (
    <div ref={rootRef}>
      {/* The demo is for sighted visitors; screen readers get one sentence instead of a stream of changes. */}
      <p className="sr-only">
        A demo of Orin: a one-sentence prompt for a spice shop landing page is sent, the agent runs commands in a sandbox,
        the page assembles in a live preview, an error is caught and fixed automatically, and the finished shop is shown.
      </p>
      <div aria-hidden="true">{desktop ? <DesktopDemo {...view} /> : <PhoneDemo {...view} />}</div>
    </div>
  )
}

type View = {
  events: AgentEvent[]; typed: string | null; pressed: boolean; parts: ReadonlySet<MalabarPart>; icons: boolean
  previewUp: boolean; status: ReturnType<typeof runStatus>; trouble: ReturnType<typeof appTrouble>; left: number; snaps: number
}

// Desktop: the builder in a window, sitting on the painted tile. Scrolling it into view lifts the
// window and drifts the painting — transform only, so nothing here depends on the motion running.
function DesktopDemo(v: View) {
  const tileRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: tileRef, offset: ['start end', 'end start'] })
  const paintY = useTransform(scrollYProgress, [0, 1], ['-5%', '5%'])
  const winY = useTransform(scrollYProgress, [0, 0.42], [80, 0])
  const winScale = useTransform(scrollYProgress, [0, 0.42], [0.94, 1])

  return (
    <div ref={tileRef} className="relative h-[min(700px,calc(100svh-72px))] min-h-[580px] overflow-hidden rounded-[22px]">
      <motion.div style={{ y: paintY }} className="absolute -inset-y-[6%] inset-x-0 bg-[image:image-set(url(/landing/tile.avif)_type('image/avif'),url(/landing/tile.webp)_type('image/webp'))] bg-cover bg-center dark:brightness-75" />
      <motion.div style={{ y: winY, scale: winScale }} className="absolute inset-x-[5.5%] top-10 bottom-10 flex flex-col overflow-hidden rounded-[14px] border bg-background shadow-[0_40px_80px_-40px_rgb(20_12_4/0.6)]">
        <div className="relative flex h-10 shrink-0 items-center gap-1.5 border-b px-4">
          {[0, 1, 2].map((i) => <span key={i} className="size-[11px] rounded-full bg-border" />)}
          <span className="absolute left-1/2 -translate-x-1/2 rounded-md border bg-card px-3 py-0.5 font-mono text-[11.5px] text-muted-foreground">orin.ashutoshsao.com</span>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,37%)_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-r">
            <ChatHeader snaps={v.snaps} />
            <Feed events={v.events} status={v.status} />
            <Composer typed={v.typed} pressed={v.pressed} left={v.left} />
          </div>
          <div className="flex min-h-0 p-4"><PreviewCard {...v} /></div>
        </div>
      </motion.div>
    </div>
  )
}

// Phone: the real mobile builder — navigation on top, the preview as the screen, the conversation as
// a sheet with the composer on its top edge. No painting here; the width is worth more.
function PhoneDemo(v: View) {
  return (
    <div className="mx-auto flex h-[640px] max-w-[400px] flex-col overflow-hidden rounded-[26px] border bg-background shadow-[0_30px_60px_-40px_rgb(20_12_4/0.5)]">
      <ChatHeader snaps={v.snaps} />
      <div className="flex min-h-0 flex-1 px-3 pb-3"><PreviewCard {...v} /></div>
      <div className="-mt-4 flex h-[250px] shrink-0 flex-col rounded-t-[20px] border-t bg-background shadow-[0_-16px_40px_-24px_rgb(60_40_20/0.45)]">
        <div className="flex justify-center py-2.5"><span className="h-1 w-9 rounded-full bg-border" /></div>
        <div className="flex items-center gap-2 px-5 pb-2 font-mono text-xs">
          <span className={cn('size-1.5 rounded-full bg-primary', v.status.active && 'animate-pulse shadow-[0_0_0_4px] shadow-primary/20')} />
          <span className="text-foreground/80">{v.status.label}</span>
        </div>
        <Composer typed={v.typed} pressed={v.pressed} left={v.left} compact />
        <div className="flex min-h-0 flex-1 flex-col border-t"><Feed events={v.events} status={v.status} /></div>
      </div>
    </div>
  )
}

function ChatHeader({ snaps }: { snaps: number }) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 px-3 pt-4 pb-3">
      <div className="flex min-w-0 items-center gap-1">
        <span className="grid size-7 place-items-center text-muted-foreground"><ChevronLeft className="size-4" /></span>
        <span className="truncate font-display text-[21px] leading-none tracking-[-0.01em]">Malabar spices</span>
      </div>
      <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-opacity duration-300', snaps ? 'opacity-100' : 'opacity-0')}>
        <History className="size-3.5" />{snaps} {snaps === 1 ? 'snapshot' : 'snapshots'}
      </span>
    </header>
  )
}

// The feed, grouped exactly as the builder groups it.
function Feed({ events, status }: { events: AgentEvent[]; status: View['status'] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [events])
  const feed = groupFeed(events)
  const lastActivity = feed.map((f) => f.type).lastIndexOf('activity')

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-hidden px-5 py-3">
      <div className="flex flex-col gap-[20px]">
        {feed.map((item, i) => {
          if (item.type === 'activity') return <Group key={i} events={item.events} working={status.building && i === lastActivity} />
          if (item.type !== 'message') return null
          const e = item.event
          if (e.event === 'run_start') {
            return (
              <Timed key={i} ts={e.ts} bubble>
                <div className="ml-auto w-fit max-w-[270px] rounded-[16px_16px_4px_16px] border bg-card px-3.5 py-2.5 text-[14px] leading-normal">{String(e.userPrompt)}</div>
              </Timed>
            )
          }
          return <Timed key={i} ts={e.ts}><p className="text-[14px] leading-relaxed text-foreground/85">{String(e.content ?? '')}</p></Timed>
        })}
      </div>
    </div>
  )
}

function Timed({ ts, children, bubble }: { ts: unknown; children: React.ReactNode; bubble?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="grid grid-cols-[44px_minmax(0,1fr)] items-start">
      <span className={cn('font-mono text-[11px] text-muted-foreground/70', bubble ? 'pt-3' : 'pt-1')}>{clockTime(ts)}</span>
      <div className="min-w-0">{children}</div>
    </motion.div>
  )
}

function Group({ events, working }: { events: AgentEvent[]; working: boolean }) {
  return (
    <div className="pl-11">
      <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        {working
          ? <span className="size-[7px] animate-pulse rounded-full bg-primary shadow-[0_0_0_4px] shadow-primary/20" />
          : <ChevronRight className="size-3" />}
        {working && <span className="text-foreground">working</span>}
        <span className={cn(working && 'text-muted-foreground/80')}>{working ? `· ${summarizeActivity(events)}` : summarizeActivity(events)}</span>
      </p>
      <AnimatePresence initial={false}>
        {working && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className="overflow-hidden">
            <div className="mt-2 ml-[3px] space-y-1.5 border-l pl-3.5">
              {events.map((e, i) => {
                const { label, detail } = activityLine(e)
                return (
                  <motion.p key={i} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex gap-2.5 font-mono text-xs text-muted-foreground">
                    <span className="shrink-0 opacity-70">{label}</span>
                    {detail && <span className="truncate">{detail}</span>}
                  </motion.p>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Composer({ typed, pressed, left, compact }: { typed: string | null; pressed: boolean; left: number; compact?: boolean }) {
  return (
    <div className={cn('shrink-0', compact ? 'px-4 pb-3' : 'px-4 pt-2 pb-4')}>
      <div className="flex items-center gap-2.5 rounded-2xl border bg-card py-2 pr-2 pl-4 shadow-[0_10px_28px_-18px_rgb(60_40_20/0.3)] dark:shadow-none">
        <span className="min-w-0 flex-1 truncate text-[14px]">
          {typed === null
            ? <span className="text-muted-foreground/80">Ask for a change…</span>
            : <>{typed}<span className="ml-px inline-block h-[1.05em] w-[1.5px] animate-pulse bg-foreground align-[-0.15em]" /></>}
        </span>
        <span className={cn('rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-transform duration-100', pressed && 'scale-90')}>Send</span>
      </div>
      {!compact && <p className="mt-2 px-1 font-mono text-[11px] text-muted-foreground">Trial · {left} steps left</p>}
    </div>
  )
}

function PreviewCard(v: View) {
  const [head, ...rest] = v.status.label.split(' · ')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_0_rgb(28_24_20/0.04),0_24px_48px_-30px_rgb(60_40_20/0.35)] dark:shadow-none">
      <div className="flex h-[42px] shrink-0 items-center justify-between border-b px-3.5">
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className={cn('size-1.5 rounded-full bg-primary', v.status.active && 'animate-pulse shadow-[0_0_0_4px] shadow-primary/20')} />
          <span className="text-foreground/80">{head}</span>
          {rest.length > 0 && <span className="text-muted-foreground">· {rest.join(' · ')}</span>}
        </div>
        <div className="flex gap-0.5 text-muted-foreground">
          <span className="grid size-7 place-items-center"><RotateCw className="size-3.5" /></span>
          <span className="grid size-7 place-items-center"><ExternalLink className="size-3.5" /></span>
        </div>
      </div>
      <div className="relative flex-1 bg-white">
        <MalabarApp parts={v.parts} icons={v.icons} broken={v.trouble !== null} />
        <div className={cn('absolute inset-0 bg-card transition-opacity duration-300', v.previewUp ? 'pointer-events-none opacity-0' : 'opacity-100')}>
          <DotField className="text-muted-foreground" />
          <p className="absolute inset-x-0 bottom-4 text-center font-mono text-xs text-muted-foreground">Building your app</p>
        </div>
        <AnimatePresence>{v.trouble && <PreviewTrouble key={v.trouble} state={v.trouble} />}</AnimatePresence>
      </div>
    </div>
  )
}
