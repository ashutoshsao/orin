import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
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

// For the engineers reading: one build round as a branch bloom. The prompt grows a trunk from the
// browser to the API; the API then blooms — four branches at once, to the model, the sandbox,
// Postgres and R2, because a round really does touch all four — twigs sprout, each box it reaches
// ripples, and the preview arcs from the sandbox straight back to the browser. Then it recedes and
// blooms again. It plays on its own; the faint wiring underneath means it reads with no motion at all.
type NodeKey = 'browser' | 'api' | 'llm' | 'sandbox' | 'pg' | 'r2'
const NODE_TEXT: Record<NodeKey, { t: string; s: string }> = {
  browser: { t: 'Your browser', s: 'React · Vercel' },
  api: { t: 'Orin API', s: 'Bun · Elysia · GKE' },
  llm: { t: 'The model', s: '4 providers, one interface' },
  sandbox: { t: 'E2B sandbox', s: 'Vite dev server' },
  pg: { t: 'Postgres', s: 'saved every round' },
  r2: { t: 'Redis → R2', s: 'git bundle per round' },
}
type Layout = {
  w: number; h: number; nodeW: string
  at: Record<NodeKey, [number, number]>
  trunk: string
  branches: string[]                                   // all four bloom at the same instant
  twigs: { d: string; tip: [number, number] }[]
  arc: string                                          // sandbox → browser: the live preview
  labels: { x: number; y: number; t: string; anchor?: 'start' | 'middle' | 'end' }[]
}
const WIDE: Layout = {
  w: 900, h: 380, nodeW: '19%',
  at: { browser: [120, 190], api: [460, 190], llm: [460, 62], sandbox: [780, 110], pg: [460, 318], r2: [780, 290] },
  trunk: 'M 208 190 C 262 174, 318 206, 372 190',
  branches: [
    'M 460 166 C 446 140, 474 112, 460 86',
    'M 548 178 C 604 178, 628 122, 692 118',
    'M 460 214 C 474 240, 446 268, 460 294',
    'M 548 202 C 604 202, 628 280, 692 282',
  ],
  twigs: [
    { d: 'M 457 128 C 446 120, 438 112, 428 108', tip: [428, 108] },
    { d: 'M 612 156 C 618 146, 626 142, 638 142', tip: [638, 142] },
    { d: 'M 463 254 C 474 262, 482 268, 494 272', tip: [494, 272] },
    { d: 'M 612 226 C 620 238, 628 242, 640 242', tip: [640, 242] },
    { d: 'M 290 190 C 296 204, 300 210, 308 214', tip: [308, 214] },
  ],
  arc: 'M 692 96 Q 430 -118 150 166',
  labels: [
    { x: 290, y: 176, t: 'server-sent events', anchor: 'middle' },
    { x: 474, y: 128, t: 'model calls' },
    { x: 566, y: 110, t: 'bash_tool' },
    { x: 300, y: 30, t: 'live preview', anchor: 'middle' },
    { x: 474, y: 258, t: 'every round' },
    { x: 578, y: 300, t: 'snapshot queue' },
  ],
}
// Phones: the same tree standing up — browser on top, the API below it, four branches fanning down.
const TALL: Layout = {
  w: 360, h: 600, nodeW: '44%',
  at: { browser: [180, 44], api: [180, 196], llm: [88, 350], sandbox: [272, 350], pg: [88, 520], r2: [272, 520] },
  trunk: 'M 180 72 C 168 110, 192 140, 180 168',
  branches: [
    'M 150 224 C 130 260, 96 280, 88 322',
    'M 210 224 C 230 260, 264 280, 272 322',
    'M 164 224 C 150 330, 70 420, 80 492',
    'M 196 224 C 210 330, 290 420, 280 492',
  ],
  twigs: [
    { d: 'M 120 262 C 108 258, 100 250, 94 240', tip: [94, 240] },
    { d: 'M 240 262 C 252 258, 260 250, 266 240', tip: [266, 240] },
    { d: 'M 176 120 C 190 116, 198 110, 204 102', tip: [204, 102] },
  ],
  arc: 'M 330 330 C 372 220, 356 60, 270 44',
  labels: [
    { x: 196, y: 128, t: 'events' },
    { x: 356, y: 200, t: 'preview', anchor: 'end' },
  ],
}

// One loop, in fractions of it. Everything shares these, which is what makes the bloom synchronous.
const LOOP = 6.5
const T = { origin: 0.04, api: 0.16, bloom: 0.36, twig: 0.42, preview: 0.54, hold: 0.8, gone: 0.92 }
const grow = (start: number, end: number) => ({
  pathLength: [0, 0, 1, 1, 0, 0],
  opacity: [0, 1, 1, 1, 0, 0],
  transition: { duration: LOOP, times: [0, start, end, T.hold, T.gone, 1], repeat: Infinity, ease: 'easeInOut' as const },
})
const ARRIVE: Record<NodeKey, number> = { browser: T.origin, api: T.api, llm: T.bloom, sandbox: T.bloom, pg: T.bloom, r2: T.bloom }

function HowItsBuilt() {
  const reduced = !!useReducedMotion()
  return (
    // `dark` scopes the dark palette to this band, so it reads as a change of room in either theme.
    <section id="built" className="dark scroll-mt-16 bg-background text-foreground">
      <div className="mx-auto max-w-[1360px] px-4 py-20 md:px-10 md:py-28">
        <h2 className="max-w-[18ch] font-wide text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.02] font-[720] tracking-[-0.02em] text-balance [font-stretch:112%]">
          How it's <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">built</span>
        </h2>
        <p className="mt-5 max-w-[44rem] text-lg leading-relaxed text-muted-foreground">
          A learning project, written part by part: the agent loop, the sandbox, the event stream, persistence and the deploy are all hand-built rather than taken from a framework. Here is one build round.
        </p>
        <div className="mt-14 hidden md:block"><Bloom layout={WIDE} still={reduced} /></div>
        <div className="mx-auto mt-10 max-w-[400px] md:hidden"><Bloom layout={TALL} still={reduced} /></div>
        <ol className="mt-14 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {ROUND.map(([title, body], i) => (
            <li key={title}>
              <p className="font-mono text-xs text-muted-foreground">{i + 1}</p>
              <p className="mt-1 font-semibold">{title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
        <ul className="mt-14 flex flex-wrap gap-2">
          {STACK.map((t) => <li key={t} className="rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground">{t}</li>)}
        </ul>
        <a href={SOURCE} className="mt-10 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-card">
          <GithubMark />Read the source on GitHub
        </a>
      </div>
    </section>
  )
}

const ROUND: [string, string][] = [
  ['You ask', 'Your prompt reaches the API. Everything after this streams back to the page as server-sent events.'],
  ['It thinks', 'The model reads the conversation so far and answers with the next tool calls.'],
  ['It runs', 'Each call runs as a shell command in the project’s own E2B sandbox: writing files, installing packages.'],
  ['You watch', 'The preview is the sandbox’s own Vite dev server, loaded straight into the page — not through the API.'],
  ['It saves', 'When the round ends, the conversation is written to Postgres — never halfway through one.'],
  ['It snapshots', 'The files are committed, bundled and queued for R2, so any round can be rewound to later.'],
]
const STACK = ['Bun', 'Elysia', 'React', 'Tailwind', 'Drizzle', 'Postgres', 'Better Auth', 'E2B', 'Redis', 'Cloudflare R2', 'GKE', 'Vercel']

function Bloom({ layout: L, still }: { layout: Layout; still: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // Only loops while on screen; under Reduce Motion it's the fully bloomed tree, standing still.
  const inView = useInView(ref, { amount: 0.25 })
  const play = inView && !still
  const all = [L.trunk, ...L.branches, ...L.twigs.map((t) => t.d), L.arc]
  const drawn = (d: string, start: number, end: number, width = 1.8) =>
    play
      ? <motion.path key={d} d={d} fill="none" className="stroke-primary" strokeWidth={width} strokeLinecap="round" initial={{ pathLength: 0, opacity: 0 }} animate={grow(start, end)} />
      : <path key={d} d={d} fill="none" className="stroke-primary" strokeWidth={width} strokeLinecap="round" opacity={still ? 0.85 : 0} />

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[1100px]" style={{ aspectRatio: `${L.w} / ${L.h}` }}>
      <svg viewBox={`0 0 ${L.w} ${L.h}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {/* the wiring, always there */}
        {all.map((d) => <path key={`base-${d}`} d={d} fill="none" className="stroke-border" strokeWidth="1.2" strokeDasharray="3 5" />)}
        {L.labels.map((l) => <text key={l.t} x={l.x} y={l.y} textAnchor={l.anchor ?? 'start'} className="fill-muted-foreground font-mono text-[10.5px]">{l.t}</text>)}
        {/* the bloom: trunk, then four branches at once, then twigs, then the preview arcing home */}
        {drawn(L.trunk, T.origin, T.api, 2.2)}
        {L.branches.map((d) => drawn(d, T.api, T.bloom))}
        {L.twigs.map((t) => drawn(t.d, T.bloom - 0.06, T.twig, 1.3))}
        {drawn(L.arc, T.bloom + 0.02, T.preview)}
        {L.twigs.map((t) => play
          ? <motion.circle key={`tip-${t.d}`} cx={t.tip[0]} cy={t.tip[1]} r="3" className="fill-primary" initial={{ scale: 0 }}
              animate={{ scale: [0, 0, 1, 1, 0, 0], transition: { duration: LOOP, times: [0, T.twig - 0.02, T.twig + 0.03, T.hold, T.gone, 1], repeat: Infinity } }} />
          : <circle key={`tip-${t.d}`} cx={t.tip[0]} cy={t.tip[1]} r="3" className="fill-primary" opacity={still ? 0.85 : 0} />)}
      </svg>
      {(Object.keys(L.at) as NodeKey[]).map((k) => (
        <BloomNode key={k} k={k} x={(L.at[k][0] / L.w) * 100} y={(L.at[k][1] / L.h) * 100} width={L.nodeW} play={play} still={still} />
      ))}
    </div>
  )
}

function BloomNode({ k, x, y, width, play, still }: { k: NodeKey; x: number; y: number; width: string; play: boolean; still: boolean }) {
  const a = ARRIVE[k]
  const lit = { opacity: [0, 0, 1, 1, 0, 0], transition: { duration: LOOP, times: [0, a, a + 0.03, T.hold, T.gone, 1], repeat: Infinity } }
  // A ripple as the branch arrives — and for the browser, a second one when the preview lands.
  const ripple = (at: number) => ({ scale: [1, 1, 1.14, 1.14], opacity: [0, 0.9, 0, 0], transition: { duration: LOOP, times: [0, at, Math.min(at + 0.12, 0.99), 1], repeat: Infinity, ease: 'easeOut' as const } })
  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card px-3 py-2.5 md:px-3.5 md:py-3" style={{ left: `${x}%`, top: `${y}%`, width }}>
      {play && <>
        <motion.span initial={{ opacity: 0 }} animate={lit} className="pointer-events-none absolute -inset-px rounded-xl border border-primary shadow-[0_0_28px_-8px] shadow-primary/60" />
        <motion.span initial={{ opacity: 0 }} animate={ripple(a)} className="pointer-events-none absolute -inset-px rounded-xl border border-primary" />
        {k === 'browser' && <motion.span initial={{ opacity: 0 }} animate={ripple(T.preview)} className="pointer-events-none absolute -inset-px rounded-xl border border-primary" />}
      </>}
      {still && <span className="pointer-events-none absolute -inset-px rounded-xl border border-primary/70" />}
      <p className="relative text-[13px] font-semibold md:text-sm">{NODE_TEXT[k].t}</p>
      <p className="relative mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground md:text-[11px]">{NODE_TEXT[k].s}</p>
    </div>
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
