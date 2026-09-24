import { useEffect, useRef, useState } from 'react'
import type { MotionValue } from 'motion/react'
import { AnimatePresence, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { Wordmark, GithubMark } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { DotField } from '@/components/DotField'
import { cn } from '@/lib/utils'
import { LandingDemo } from './LandingDemo'

const SOURCE = 'https://github.com/ashutoshsao/orin'

// The public front door (spec 10). Motion follows one rule: it is transform-only or runs on mount,
// never content held at opacity 0 until a scroll observer fires — that exact pattern blanked a
// generated site for every visitor without Reduce Motion, and the page selling the agent that now
// refuses to write it shouldn't ship it either.
export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <Nav onStart={onStart} />
      <main>
        <Hero onStart={onStart} />
        <section className="mx-auto max-w-[1360px] px-4 pb-24 md:px-10" aria-label="See Orin build an app">
          <LandingDemo />
        </section>
        <HowItWorks />
        <Different />
        <HowItsBuilt />
        <Closing onStart={onStart} />
      </main>
      <Footer />
    </div>
  )
}

function Nav({ onStart }: { onStart: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  return (
    <header className={cn('sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-200', scrolled ? 'border-b bg-background/80 backdrop-blur-md' : 'border-b border-transparent')}>
      <nav className="mx-auto flex h-16 max-w-[1360px] items-center justify-between px-4 md:px-10">
        <Wordmark />
        <div className="flex items-center gap-1 md:gap-5">
          <a href="#how" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline">How it works</a>
          <a href="#built" className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline">How it's built</a>
          <a href={SOURCE} className="hidden text-sm text-muted-foreground transition-colors hover:text-foreground md:inline">Source</a>
          <ThemeToggle />
          <button onClick={onStart} className="rounded-full border px-4 py-2 text-sm font-medium transition-colors hover:bg-card">Sign in</button>
        </div>
      </nav>
    </header>
  )
}

// The one orchestrated page-load moment: the headline rises in word by word. It runs on mount (no
// observer involved), and under Reduce Motion MotionConfig drops the movement.
const LINE_1 = ['Describe', 'an', 'app.']
const LINE_2: { w: string; italic?: boolean }[] = [{ w: 'Watch it', italic: true }, { w: 'build' }, { w: 'itself.' }]

function Hero({ onStart }: { onStart: () => void }) {
  const word = (i: number) => ({
    initial: { opacity: 0, y: '0.35em' },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: 0.08 + i * 0.07, ease: [0.2, 0.8, 0.2, 1] as const },
  })
  return (
    <section className="mx-auto max-w-[1360px] px-4 pt-14 pb-12 md:px-10 md:pt-24 md:pb-16">
      <h1 className="max-w-[16ch] font-wide text-[clamp(2.7rem,7.4vw,6.6rem)] leading-[0.98] font-[760] tracking-[-0.025em] text-balance [font-stretch:116%]">
        <span className="block">
          {LINE_1.map((w, i) => <motion.span key={w} {...word(i)} className="mr-[0.22em] inline-block">{w}</motion.span>)}
        </span>
        <span className="block">
          {LINE_2.map(({ w, italic }, i) => (
            <motion.span key={w} {...word(i + LINE_1.length)} className={cn('mr-[0.22em] inline-block', italic && 'pr-[0.04em] font-display text-[1.1em] font-normal tracking-[-0.01em] italic [font-stretch:100%]')}>{w}</motion.span>
          ))}
        </span>
      </h1>
      <motion.p {...word(7)} className="mt-6 max-w-[36rem] text-lg leading-relaxed text-muted-foreground md:text-xl">
        Orin is an AI agent that writes real code in a live sandbox. You watch the app appear as it works, then keep steering it.
      </motion.p>
      <motion.div {...word(8)} className="mt-8 flex flex-wrap gap-3">
        <button onClick={onStart} className="rounded-full bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-transform hover:-translate-y-px active:translate-y-0">Start building</button>
        <a href="#built" className="rounded-full border px-6 py-3 text-[15px] font-medium transition-colors hover:bg-card">See how it's built</a>
      </motion.div>
    </section>
  )
}

const STEPS = [
  { n: '1', title: 'Describe', body: 'Say what you want in a sentence. If something is unclear, Orin asks before it guesses.' },
  { n: '2', title: 'Watch', body: 'The agent writes files, installs packages and runs them in a real sandbox. The preview reloads as it goes.' },
  { n: '3', title: 'Steer', body: 'Ask for changes in plain words, or rewind to any snapshot when a turn heads the wrong way.' },
]

// The headline rides a curve and slides right-to-left as you scroll (after aardvarkbookclub.com):
// an SVG arc, the words on it via <textPath>, and scroll progress driving `startOffset`, so each
// letter tilts to follow the curve. Their glide comes from Lenis hijacking the page scroll; here the
// scroll value is sprung instead, which gives the same smoothness while leaving native scrolling alone.
const ARC = 'M -160 382 C 60 282 820 172 1300 172 C 1780 172 2240 292 2740 382'

function CurvedHeadline() {
  const ref = useRef<HTMLDivElement>(null)
  const path = useRef<SVGPathElement>(null)
  const text = useRef<SVGTextElement>(null)
  const along = useRef<SVGTextPathElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const smooth = useSpring(scrollYProgress, { stiffness: 80, damping: 22, mass: 0.35 })
  // How far past the path's start the text must travel to clear it: its own length, as a share of
  // the path's. Measured, because it depends on the font actually loaded.
  const travel = useRef(170)

  useEffect(() => {
    const measure = () => {
      const t = text.current, p = path.current
      if (t && p && p.getTotalLength() > 0) travel.current = (t.getComputedTextLength() / p.getTotalLength()) * 100
    }
    measure()
    document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useMotionValueEvent(smooth, 'change', (p) => {
    // 100% = parked just past the right end; the far end = its last letter has left on the left.
    along.current?.setAttribute('startOffset', `${100 - p * (100 + travel.current)}%`)
  })

  // Reduce Motion: a sentence that only reads while it moves is no sentence at all — show it plainly.
  if (reduced) {
    return (
      <h2 className="mx-auto max-w-[1360px] px-4 font-wide text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.02] font-[720] tracking-[-0.02em] text-balance [font-stretch:112%] md:px-10">
        One sentence in, <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">a working app</span> out.
      </h2>
    )
  }
  return (
    <div ref={ref} className="overflow-hidden">
      <h2 className="sr-only">One sentence in, a working app out.</h2>
      {/* On phones the arc is drawn wider than the screen and centred, so the letters stay big —
          squeezed into 390px they'd be ~30px tall and lose the whole effect. */}
      <svg viewBox="0 0 1920 420" className="-ml-[45%] block w-[190%] max-w-none overflow-visible md:ml-0 md:w-full" aria-hidden="true">
        <path ref={path} id="orin-arc" d={ARC} fill="none" />
        <text ref={text} className="fill-foreground font-wide text-[170px] font-[760] tracking-[-0.02em] [font-stretch:116%]">
          <textPath ref={along} href="#orin-arc" startOffset="100%">
            One sentence in, <tspan className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]" fontSize="1.12em">a working app</tspan> out.
          </textPath>
        </text>
      </svg>
    </div>
  )
}

// Three big words that ink in as you scroll past them — a left-to-right wipe from a faint copy to a
// full one. The faint copy is always there, so the steps read even if the motion never runs.
function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-t pt-16 md:pt-24">
      <CurvedHeadline />
      <div className="mx-auto max-w-[1360px] px-4 pt-8 pb-20 md:px-10 md:pt-12 md:pb-28">
        <ol className="divide-y border-y">
          {STEPS.map((s) => <Step key={s.n} {...s} />)}
        </ol>
      </div>
    </section>
  )
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  const ref = useRef<HTMLLIElement>(null)
  const reduced = useReducedMotion()
  // Starts inking as the row comes up past 80% of the screen, done by 45%.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'start 45%'] })
  const ink = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.3 })
  const clip = useTransform(ink, (v) => `inset(0 ${100 - v * 100}% 0 0)`)
  const word = 'font-wide text-[clamp(3rem,9vw,7.5rem)] leading-[0.95] font-[760] tracking-[-0.03em] [font-stretch:116%]'
  return (
    <li ref={ref} className="grid items-end gap-3 py-8 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:gap-10 md:py-10">
      <div className="flex items-start gap-4">
        <span className="mt-3 font-mono text-sm text-muted-foreground md:mt-5">{n}</span>
        <h3 className="relative">
          <span className={cn(word, 'block text-foreground/12')}>{title}</span>
          <motion.span aria-hidden="true" style={reduced ? undefined : { clipPath: clip }} className={cn(word, 'absolute inset-0 block text-foreground')}>{title}</motion.span>
        </h3>
      </div>
      <p className="max-w-[40ch] pb-2 text-lg leading-relaxed text-muted-foreground">{body}</p>
    </li>
  )
}

const DIFFERENT = [
  { t: 'It fixes its own mistakes', b: 'When the app stops compiling, the agent is handed the error and fixes it. You see "fixing an error", not a stack trace.' },
  { t: 'Real code, not a mock-up', b: 'Every app is a Vite and React project running in its own sandbox. What the preview shows is what the code does.' },
  { t: 'Rewind any turn', b: 'Each round is snapshotted. Go back to any point and take the build somewhere else.' },
  { t: 'Bring your own model', b: 'DeepSeek, OpenAI, Gemini or Claude, with your own key. Keys stay in memory — never in a database, never in the sandbox.' },
  { t: 'Works on your phone', b: 'Preview first on small screens, with the conversation in a sheet you drag up.' },
]

// Not a sequence and not a card grid: an editorial list, one hairline between each.
function Different() {
  return (
    <section className="border-t">
      <div className="mx-auto max-w-[1360px] px-4 py-20 md:px-10 md:py-28">
        <h2 className="max-w-[20ch] font-wide text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.02] font-[720] tracking-[-0.02em] text-balance [font-stretch:112%]">
          The parts that usually <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">go wrong</span>
        </h2>
        <dl className="mt-12 divide-y border-y">
          {DIFFERENT.map((d) => (
            <div key={d.t} className="grid gap-2 py-7 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10">
              <dt className="text-xl font-semibold tracking-[-0.01em] md:text-2xl">{d.t}</dt>
              <dd className="max-w-[52ch] leading-relaxed text-muted-foreground md:pt-1">{d.b}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}

// For the engineers reading. The section's job is to explain what happens during ONE build round,
// in order — so the animation is that order. The diagram pins, and scrolling is time: each step draws
// one hop from its source to its target, lights the box it reaches, and captions what just happened.
// (An earlier version looped packets along every wire at once: motion with no meaning.)
const VB = { w: 900, h: 380 }
type NodeKey = 'browser' | 'api' | 'llm' | 'sandbox' | 'pg' | 'r2'
const NODES: Record<NodeKey, { x: number; y: number; t: string; s: string }> = {
  browser: { x: 120, y: 190, t: 'Your browser', s: 'React · Vercel' },
  api: { x: 460, y: 190, t: 'Orin API', s: 'Bun · Elysia · GKE' },
  llm: { x: 460, y: 62, t: 'The model', s: '4 providers, one interface' },
  sandbox: { x: 780, y: 110, t: 'E2B sandbox', s: 'Vite dev server' },
  pg: { x: 460, y: 318, t: 'Postgres', s: 'saved every round' },
  r2: { x: 780, y: 290, t: 'Redis → R2', s: 'git bundle per round' },
}
// In request order. Each path runs source → target, so it draws in the direction the data moves.
const HOPS: { d: string; to: NodeKey; label: string; lx: number; ly: number; anchor?: 'start' | 'middle'; title: string; body: string }[] = [
  { d: 'M 208 190 L 372 190', to: 'api', label: 'server-sent events', lx: 290, ly: 180, anchor: 'middle',
    title: 'You ask', body: 'Your prompt reaches the API. Everything after this streams back to the page as server-sent events.' },
  { d: 'M 460 166 L 460 86', to: 'llm', label: 'model calls', lx: 470, ly: 130,
    title: 'It thinks', body: 'The model reads the conversation so far and answers with the next tool calls.' },
  { d: 'M 548 176 L 692 124', to: 'sandbox', label: 'bash_tool', lx: 612, ly: 138, anchor: 'middle',
    title: 'It runs', body: 'Each call runs as a shell command in the project’s own E2B sandbox: writing files, installing packages.' },
  { d: 'M 692 96 Q 430 -118 150 166', to: 'browser', label: 'live preview', lx: 300, ly: 30, anchor: 'middle',
    title: 'You watch', body: 'The preview is the sandbox’s own Vite dev server, loaded straight into the page — not proxied through the API.' },
  { d: 'M 460 214 L 460 294', to: 'pg', label: 'every round', lx: 470, ly: 258,
    title: 'It saves', body: 'When the round ends, the conversation is written to Postgres — never halfway through one.' },
  { d: 'M 548 204 L 692 276', to: 'r2', label: 'snapshot queue', lx: 612, ly: 256, anchor: 'middle',
    title: 'It snapshots', body: 'The files are committed, bundled and queued for R2, so any round can be rewound to later.' },
]
const N = HOPS.length
// Within its slice of the scroll, a hop draws over the first 60% and rests for the remainder.
const drawn = (i: number) => [i / N + 0.012, i / N + 0.6 / N] as const

function HowItsBuilt() {
  const reduced = useReducedMotion()
  return (
    // `dark` scopes the dark palette to this band, so it reads as a change of room in either theme.
    <section id="built" className="dark scroll-mt-16 bg-background text-foreground">
      <div className="mx-auto max-w-[1360px] px-4 pt-20 md:px-10 md:pt-28">
        <h2 className="max-w-[18ch] font-wide text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.02] font-[720] tracking-[-0.02em] text-balance [font-stretch:112%]">
          How it's <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">built</span>
        </h2>
        <p className="mt-5 max-w-[44rem] text-lg leading-relaxed text-muted-foreground">
          A learning project, written part by part: the agent loop, the sandbox, the event stream, persistence and the deploy are all hand-built rather than taken from a framework. Here is one build round, hop by hop.
        </p>
      </div>
      <div className="hidden md:block">{reduced ? <StillTrace /> : <ScrollTrace />}</div>
      <div className="md:hidden"><PhoneTrace reduced={!!reduced} /></div>
      <div className="mx-auto max-w-[1360px] px-4 pb-20 md:px-10 md:pb-28">
        <ul className="flex flex-wrap gap-2">
          {STACK.map((t) => <li key={t} className="rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground">{t}</li>)}
        </ul>
        <a href={SOURCE} className="mt-10 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-card">
          <GithubMark />Read the source on GitHub
        </a>
      </div>
    </section>
  )
}

const STACK = ['Bun', 'Elysia', 'React', 'Tailwind', 'Drizzle', 'Postgres', 'Better Auth', 'E2B', 'Redis', 'Cloudflare R2', 'GKE', 'Vercel']

function ScrollTrace() {
  const track = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })
  const [step, setStep] = useState(0)
  useMotionValueEvent(p, 'change', (v) => setStep(Math.min(N - 1, Math.max(0, Math.floor(v * N)))))
  return (
    <div ref={track} className="relative h-[360vh]">
      <div className="sticky top-16 flex h-[calc(100svh-4rem)] flex-col justify-center gap-8 px-10">
        <Diagram p={p} />
        <Caption step={step} />
      </div>
    </div>
  )
}

// Reduce Motion: the finished trace, and all six steps written out.
function StillTrace() {
  const done = useMotionValue(1)
  return (
    <div className="px-10 py-12">
      <Diagram p={done} />
      <ol className="mx-auto mt-10 grid max-w-[1100px] grid-cols-3 gap-x-10 gap-y-6">
        {HOPS.map((h, i) => (
          <li key={h.title}><p className="font-mono text-xs text-muted-foreground">{i + 1}</p><p className="mt-1 font-semibold">{h.title}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{h.body}</p></li>
        ))}
      </ol>
    </div>
  )
}

function Diagram({ p }: { p: MotionValue<number> }) {
  return (
    <div className="relative mx-auto aspect-[900/380] w-full max-w-[1100px]">
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {HOPS.map((h) => (
          <g key={h.d}>
            <path d={h.d} fill="none" className="stroke-border" strokeWidth="1.2" strokeDasharray="3 5" />
            <text x={h.lx} y={h.ly} textAnchor={h.anchor ?? 'start'} className="fill-muted-foreground font-mono text-[10.5px]">{h.label}</text>
          </g>
        ))}
        {HOPS.map((h, i) => <Hop key={h.d} d={h.d} p={p} i={i} />)}
      </svg>
      {(Object.keys(NODES) as NodeKey[]).map((k) => {
        // The browser is where the round starts, so it's lit from the beginning.
        const litAt = k === 'browser' ? -1 : drawn(HOPS.findIndex((h) => h.to === k))[1]
        return <NodeBox key={k} n={NODES[k]} p={p} litAt={litAt} />
      })}
    </div>
  )
}

function Hop({ d, p, i }: { d: string; p: MotionValue<number>; i: number }) {
  const [from, to] = drawn(i)
  const length = useTransform(p, [from, to], [0, 1], { clamp: true })
  return <motion.path d={d} fill="none" className="stroke-primary" strokeWidth="1.8" strokeLinecap="round" style={{ pathLength: length }} />
}

function NodeBox({ n, p, litAt }: { n: { x: number; y: number; t: string; s: string }; p: MotionValue<number>; litAt: number }) {
  const lit = useTransform(p, [litAt - 0.01, litAt + 0.02], [0, 1], { clamp: true })
  return (
    <div className="absolute w-[19%] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card px-3.5 py-3" style={{ left: `${(n.x / VB.w) * 100}%`, top: `${(n.y / VB.h) * 100}%` }}>
      <motion.span style={{ opacity: lit }} className="pointer-events-none absolute -inset-px rounded-xl border border-primary shadow-[0_0_28px_-8px] shadow-primary/60" />
      <p className="relative text-sm font-semibold">{n.t}</p>
      <p className="relative mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{n.s}</p>
    </div>
  )
}

function Caption({ step }: { step: number }) {
  const h = HOPS[step]
  return (
    <div className="mx-auto flex w-full max-w-[1100px] items-start justify-between gap-10">
      <div className="min-h-[7.5rem]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
            <p className="font-mono text-xs text-muted-foreground">{step + 1} / {N}</p>
            <h3 className="mt-2 text-3xl font-semibold tracking-[-0.01em]">{h.title}</h3>
            <p className="mt-2 max-w-[56ch] leading-relaxed text-muted-foreground">{h.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
      <ol className="flex shrink-0 gap-1.5 pt-1" aria-hidden="true">
        {HOPS.map((x, i) => <li key={x.title} className={cn('h-1 w-8 rounded-full transition-colors duration-300', i <= step ? 'bg-primary' : 'bg-border')} />)}
      </ol>
    </div>
  )
}

// Phones: the same six steps as a vertical trace. The rail draws down as you scroll, and each step
// brightens as the rail reaches it — the text is always there, just quieter before its turn.
function PhoneTrace({ reduced }: { reduced: boolean }) {
  const ref = useRef<HTMLOListElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 75%', 'end 55%'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 })
  return (
    <ol ref={ref} className="relative mx-4 mt-10 mb-12 space-y-7 pl-7">
      <span className="absolute top-1 bottom-1 left-[5px] w-px bg-border" aria-hidden="true" />
      <motion.span style={reduced ? undefined : { scaleY: p }} className="absolute top-1 bottom-1 left-[5px] w-px origin-top bg-primary" aria-hidden="true" />
      {HOPS.map((h, i) => <PhoneStep key={h.title} h={h} i={i} p={p} reduced={reduced} />)}
    </ol>
  )
}

function PhoneStep({ h, i, p, reduced }: { h: (typeof HOPS)[number]; i: number; p: MotionValue<number>; reduced: boolean }) {
  const at = i / (N - 1)
  const on = useTransform(p, [at - 0.08, at], [0.4, 1], { clamp: true })
  return (
    <motion.li style={reduced ? undefined : { opacity: on }} className="relative">
      <span className="absolute top-1.5 -left-[26px] size-[9px] rounded-full border border-primary bg-background" aria-hidden="true" />
      <p className="font-mono text-xs text-muted-foreground">{NODES[h.to].t}</p>
      <p className="mt-1 text-lg font-semibold">{h.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{h.body}</p>
    </motion.li>
  )
}

// The loading state's ocean swell, used once more as the last thing on the page.
function Closing({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative overflow-hidden border-t">
      <DotField className="absolute inset-0 text-muted-foreground" />
      <div className="relative mx-auto max-w-[1360px] px-4 py-28 md:px-10 md:py-36">
        <h2 className="max-w-[14ch] font-wide text-[clamp(2.4rem,6vw,5.2rem)] leading-[0.98] font-[760] tracking-[-0.025em] text-balance [font-stretch:116%]">
          Build something <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">tonight.</span>
        </h2>
        <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-muted-foreground">
          Sign in with GitHub, add a key for DeepSeek, OpenAI, Gemini or Claude, and describe your first app.
        </p>
        <button onClick={onStart} className="mt-8 rounded-full bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-transform hover:-translate-y-px">Start building</button>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-3 px-4 py-8 text-sm text-muted-foreground md:px-10">
        <span>Orin — built by Ashutosh Sao</span>
        <a href={SOURCE} className="transition-colors hover:text-foreground">Source on GitHub</a>
      </div>
    </footer>
  )
}
