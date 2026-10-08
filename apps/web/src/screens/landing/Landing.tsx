import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { Wordmark, GithubMark } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'
import { DotField } from '@/components/DotField'
import { cn } from '@/lib/utils'
import { LandingDemo } from './LandingDemo'

const SOURCE = 'https://github.com/ashutoshsao/orin'

// The landing's pill buttons and links: bespoke (marketing size, fully round), so not the app's
// Button — but defined once, with the app's focus ring.
const PILL = 'inline-flex items-center gap-2 rounded-full font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
const PILL_SOLID = cn(PILL, 'bg-primary px-6 py-3 text-[15px] font-semibold text-primary-foreground transition-transform hover:-translate-y-px active:translate-y-0')
const PILL_OUTLINE = cn(PILL, 'border transition-colors hover:bg-card')

// The public front door (spec 10). Motion follows one rule: it is transform-only or runs on mount,
// never content held at opacity 0 until a scroll observer fires — that exact pattern blanked a
// generated site for every visitor without Reduce Motion, and the page selling the agent that now
// refuses to write it shouldn't ship it either.
export function Landing({ onStart }: { onStart: () => void }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only rounded-full bg-background px-4 py-2 text-sm font-medium ring-3 ring-ring/50 focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50">Skip to content</a>
      <Nav onStart={onStart} />
      <main id="main" tabIndex={-1} className="outline-none">
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
          <button onClick={onStart} className={cn(PILL_OUTLINE, 'px-4 py-2 text-sm')}>Sign in</button>
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
        <button onClick={onStart} className={PILL_SOLID}>Start building</button>
        <a href="#built" className={cn(PILL_OUTLINE, 'px-6 py-3 text-[15px]')}>See how it's built</a>
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
  // Where the text sits along the path at the two ends of the scroll range, as startOffset %: at the
  // start its first letter is at the screen's right edge, at the end its last letter has just left
  // the left edge — so it moves for exactly as long as the row is on screen. Measured from the path
  // and the loaded font, because both edges depend on the viewport (the phone arc is wider than it).
  const range = useRef({ from: 100, to: -100 })
  const place = (p: number) => {
    const { from, to } = range.current
    along.current?.setAttribute('startOffset', `${from + p * (to - from)}%`)
  }

  useEffect(() => {
    const measure = () => {
      const t = text.current, p = path.current, m = p?.ownerSVGElement?.getScreenCTM()
      const length = p?.getTotalLength() ?? 0
      if (!t || !p || !m || !length) return
      // The arc runs left to right, so its screen x only grows along it: binary-search each edge.
      const at = (x: number) => {
        let lo = 0, hi = length
        for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (p.getPointAtLength(mid).x * m.a + m.e < x) lo = mid; else hi = mid }
        return lo
      }
      const right = at(document.documentElement.clientWidth), left = at(0)
      range.current = { from: (right / length) * 100, to: ((left - t.getComputedTextLength()) / length) * 100 }
      place(smooth.get())
    }
    measure()
    document.fonts?.ready.then(measure)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useMotionValueEvent(smooth, 'change', place)

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
          <span aria-hidden="true" className={cn(word, 'block text-foreground/12')}>{title}</span>
          <motion.span style={reduced ? undefined : { clipPath: clip }} className={cn(word, 'absolute inset-0 block text-foreground')}>{title}</motion.span>
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
// Postgres and R2, because a round really does touch all four — each box it reaches ripples, and the
// preview arcs from the sandbox straight back to the browser. Then it recedes and blooms again. It
// plays on its own; the faint wiring underneath means it reads with no motion at all.
//
// The branches are computed from the boxes' measured edges, not drawn by hand: the boxes are HTML
// (their height is their text), so hand-placed paths in a scaled SVG only met them at one width.
type NodeKey = 'browser' | 'api' | 'llm' | 'sandbox' | 'pg' | 'r2'
const NODE_TEXT: Record<NodeKey, { t: string; s: string }> = {
  browser: { t: 'Your browser', s: 'React · Vercel' },
  api: { t: 'Orin API', s: 'Bun · Elysia · GKE' },
  llm: { t: 'The model', s: '4 providers, one interface' },
  sandbox: { t: 'E2B sandbox', s: 'Vite dev server' },
  pg: { t: 'Postgres', s: 'saved every round' },
  r2: { t: 'Redis → R2', s: 'git bundle per round' },
}
type Edge = { id: string; from: NodeKey; to: NodeKey; label?: string; side?: 'above' | 'left' | 'right'; start: number; end: number; width?: number }
type Layout = {
  w: number; h: number; nodeW: string
  at: Record<NodeKey, [number, number]>
  // wide: every branch is one curve between facing edges; tall: the API feeds a trunk down the middle
  shape: 'wide' | 'tall'
  edges: Edge[]
}
const WIDE: Layout = {
  w: 900, h: 380, nodeW: '19%', shape: 'wide',
  at: { browser: [120, 190], api: [460, 190], llm: [460, 62], sandbox: [780, 110], pg: [460, 318], r2: [780, 290] },
  edges: [
    { id: 'trunk', from: 'browser', to: 'api', label: 'server-sent events', side: 'above', start: 0.04, end: 0.16, width: 2.2 },
    { id: 'llm', from: 'api', to: 'llm', label: 'model calls', side: 'right', start: 0.16, end: 0.36 },
    { id: 'sandbox', from: 'api', to: 'sandbox', label: 'bash_tool', side: 'right', start: 0.16, end: 0.36 },
    { id: 'pg', from: 'api', to: 'pg', label: 'every round', side: 'right', start: 0.16, end: 0.36 },
    { id: 'r2', from: 'api', to: 'r2', label: 'snapshot queue', side: 'right', start: 0.16, end: 0.36 },
    { id: 'preview', from: 'sandbox', to: 'browser', label: 'live preview', side: 'above', start: 0.38, end: 0.54 },
  ],
}
// Phones: the same tree standing up — browser on top, the API below it, a trunk with four branches.
const TALL: Layout = {
  w: 360, h: 600, nodeW: '44%', shape: 'tall',
  at: { browser: [180, 44], api: [180, 196], llm: [88, 350], sandbox: [272, 350], pg: [88, 520], r2: [272, 520] },
  edges: [
    { id: 'trunk', from: 'browser', to: 'api', label: 'events', side: 'right', start: 0.04, end: 0.16, width: 2.2 },
    { id: 'llm', from: 'api', to: 'llm', start: 0.16, end: 0.36 },
    { id: 'sandbox', from: 'api', to: 'sandbox', start: 0.16, end: 0.36 },
    { id: 'pg', from: 'api', to: 'pg', start: 0.16, end: 0.36 },
    { id: 'r2', from: 'api', to: 'r2', start: 0.16, end: 0.36 },
    { id: 'preview', from: 'sandbox', to: 'browser', label: 'preview', side: 'left', start: 0.38, end: 0.54 },
  ],
}

type Box = { left: number; right: number; top: number; bottom: number; cx: number; cy: number }
type Pt = [number, number]
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const SAMPLES = 40
const cubic = (p0: Pt, c1: Pt, c2: Pt, p3: Pt) => ({
  d: `M ${p0[0]} ${p0[1]} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${p3[0]} ${p3[1]}`,
  pts: Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const t = i / SAMPLES, u = 1 - t, k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return [k[0] * p0[0] + k[1] * c1[0] + k[2] * c2[0] + k[3] * p3[0], k[0] * p0[1] + k[1] * c1[1] + k[2] * c2[1] + k[3] * p3[1]] as Pt
  }),
})
const polyline = (pts: Pt[]) => {
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < SAMPLES / (pts.length - 1); j++) {
    const t = j / (SAMPLES / (pts.length - 1)); out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t])
  }
  return [...out, pts[pts.length - 1]]
}
// One curve from box a to box b: it leaves a's edge facing b at a right angle and lands square on
// b's facing edge, so a pair that lines up is a straight line and the rest are a single smooth bend.
function between(a: Box, b: Box) {
  const inset = 10
  if (b.left > a.right || b.right < a.left) {
    const dir = Math.sign(b.cx - a.cx)
    const p0: Pt = [dir > 0 ? a.right : a.left, clamp(b.cy, a.top + inset, a.bottom - inset)]
    const p3: Pt = [dir > 0 ? b.left : b.right, clamp(a.cy, b.top + inset, b.bottom - inset)]
    const h = Math.abs(p3[0] - p0[0]) / 2
    return cubic(p0, [p0[0] + dir * h, p0[1]], [p3[0] - dir * h, p3[1]], p3)
  }
  const dir = Math.sign(b.cy - a.cy)
  const p0: Pt = [clamp(b.cx, a.left + inset, a.right - inset), dir > 0 ? a.bottom : a.top]
  const p3: Pt = [clamp(a.cx, b.left + inset, b.right - inset), dir > 0 ? b.top : b.bottom]
  const h = Math.abs(p3[1] - p0[1]) / 2
  return cubic(p0, [p0[0], p0[1] + dir * h], [p3[0], p3[1] - dir * h], p3)
}
function route(L: Layout, e: Edge, r: Record<NodeKey, Box>) {
  const a = r[e.from], b = r[e.to]
  if (e.id === 'preview') {
    if (L.shape === 'wide') {
      // over the top: up out of the sandbox, clear of every box, down into the browser
      const peak = Math.min(...Object.values(r).map((x) => x.top)) - 64
      return cubic([a.cx, a.top], [a.cx, peak], [b.cx, peak], [b.cx, b.top])
    }
    // phones: out of the sandbox's right side, up the margin, into the browser's right side
    const x = a.right + 14
    return cubic([a.right, a.cy], [x, a.cy], [x, b.cy], [b.right, b.cy])
  }
  if (L.shape === 'tall' && e.from === 'api') {
    // the trunk runs down the gap between the two columns; each box branches off it, square on
    const trunk = (r.llm.right + r.sandbox.left) / 2, rad = 10
    const toRight = b.cx > trunk, edge = toRight ? b.left : b.right, s = toRight ? 1 : -1
    return {
      d: `M ${trunk} ${a.bottom} L ${trunk} ${b.cy - rad} Q ${trunk} ${b.cy} ${trunk + s * rad} ${b.cy} L ${edge} ${b.cy}`,
      pts: polyline([[trunk, a.bottom], [trunk, b.cy], [edge, b.cy]]),
    }
  }
  return between(a, b)
}
const LABEL_AT = {
  above: { dx: 0, dy: -9, anchor: 'middle' }, below: { dx: 0, dy: 17, anchor: 'middle' },
  right: { dx: 9, dy: 4, anchor: 'start' }, left: { dx: -9, dy: 4, anchor: 'end' },
  aboveRight: { dx: 6, dy: -8, anchor: 'start' }, aboveLeft: { dx: -6, dy: -8, anchor: 'end' },
  belowRight: { dx: 6, dy: 16, anchor: 'start' }, belowLeft: { dx: -6, dy: 16, anchor: 'end' },
} as const
type Side = keyof typeof LABEL_AT
// Labels are mono at 10.5px, so their size is known from their length. Each one tries spots along its
// own branch, on each side, and takes the first that's clear of every box, every line and every other
// label — the curves change shape with the width, so no single fixed spot works everywhere.
function placeLabels(edges: { e: Edge; pts: Pt[] }[], boxes: Box[], width: number) {
  const placed: { x: number; y: number; anchor: (typeof LABEL_AT)[Side]['anchor']; text: string; id: string; rect: [number, number, number, number] }[] = []
  const lines = edges.flatMap((g) => g.pts)
  const clear = ([l, t, r, b]: [number, number, number, number]) =>
    l >= 0 && r <= width
    && boxes.every((x) => r + 4 < x.left || l - 4 > x.right || b + 4 < x.top || t - 4 > x.bottom)
    && placed.every(({ rect: [pl, pt, pr, pb] }) => r + 6 < pl || l - 6 > pr || b + 4 < pt || t - 4 > pb)
    && lines.every(([x, y]) => x < l - 3 || x > r + 3 || y < t - 3 || y > b + 3)
  for (const { e, pts } of edges) {
    if (!e.label) continue
    const w = e.label.length * 6.3
    const sides: Side[] = [e.side ?? 'above', 'right', 'left', 'above', 'below', 'aboveRight', 'aboveLeft', 'belowRight', 'belowLeft']
    let best: (typeof placed)[number] | null = null
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.15, 0.85]) {
      for (const side of sides) {
        const [px, py] = pts[Math.round(t * SAMPLES)], at = LABEL_AT[side], x = px + at.dx, y = py + at.dy
        const l = at.anchor === 'start' ? x : at.anchor === 'end' ? x - w : x - w / 2
        const rect: [number, number, number, number] = [l, y - 9, l + w, y + 3]
        if (clear(rect)) { best = { x, y, anchor: at.anchor, text: e.label, id: e.id, rect }; break }
      }
      if (best) break
    }
    // Never drop a label: with nowhere clear, it takes its preferred spot (the layout test flags it).
    if (!best) {
      const [px, py] = pts[SAMPLES / 2], at = LABEL_AT[e.side ?? 'above'], x = px + at.dx, y = py + at.dy
      const l = at.anchor === 'start' ? x : at.anchor === 'end' ? x - w : x - w / 2
      best = { x, y, anchor: at.anchor, text: e.label, id: e.id, rect: [l, y - 9, l + w, y + 3] }
    }
    placed.push(best)
  }
  return placed
}

// One loop, in fractions of it. Everything shares these, which is what makes the bloom synchronous.
const LOOP = 6.5
const T = { origin: 0.04, api: 0.16, bloom: 0.36, preview: 0.54, hold: 0.8, gone: 0.92 }
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
        <a href={SOURCE} className={cn(PILL_OUTLINE, 'mt-10 px-5 py-2.5 text-sm')}>
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
  const [geo, setGeo] = useState<{ paths: { id: string; d: string; e: Edge }[]; labels: ReturnType<typeof placeLabels> } | null>(null)

  // Measured, so the branches meet the boxes at every width: on resize, and again once the fonts
  // (which set the boxes' height) have loaded. The observer's first callback is the first measure.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const base = el.getBoundingClientRect(), r = {} as Record<NodeKey, Box>
      el.querySelectorAll<HTMLElement>('[data-node]').forEach((n) => {
        const b = n.getBoundingClientRect(), x = b.left - base.left, y = b.top - base.top
        r[n.dataset.node as NodeKey] = { left: x, right: x + b.width, top: y, bottom: y + b.height, cx: x + b.width / 2, cy: y + b.height / 2 }
      })
      const routed = L.edges.map((e) => ({ id: e.id, e, ...route(L, e, r) }))
      setGeo({ paths: routed, labels: placeLabels(routed, Object.values(r), base.width) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [L])

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-[1100px]" style={{ aspectRatio: `${L.w} / ${L.h}` }}>
      {geo && (
        <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
          {/* the wiring, always there */}
          {geo.paths.map((g) => <path key={`base-${g.id}`} d={g.d} fill="none" className="stroke-border" strokeWidth="1.2" strokeDasharray="3 5" />)}
          {geo.labels.map((l) => <text key={`label-${l.id}`} x={l.x} y={l.y} textAnchor={l.anchor} className="fill-muted-foreground font-mono text-[10.5px]">{l.text}</text>)}
          {/* the bloom: the trunk, then four branches at once, then the preview arcing home */}
          {geo.paths.map((g) => play
            ? <motion.path key={g.id} d={g.d} fill="none" className="stroke-primary" strokeWidth={g.e.width ?? 1.8} strokeLinecap="round" initial={{ pathLength: 0, opacity: 0 }} animate={grow(g.e.start, g.e.end)} />
            : <path key={g.id} d={g.d} fill="none" className="stroke-primary" strokeWidth={g.e.width ?? 1.8} strokeLinecap="round" opacity={still ? 0.85 : 0} />)}
        </svg>
      )}
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
    <div data-node={k} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card px-3 py-2.5 md:px-3.5 md:py-3" style={{ left: `${x}%`, top: `${y}%`, width }}>
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
        <button onClick={onStart} className={cn(PILL_SOLID, 'mt-8')}>Start building</button>
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
