import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react'
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

// A real sequence, so it's numbered. The line between the steps fills as the section scrolls past.
function HowItWorks() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 80%', 'end 60%'] })
  const fill = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <section id="how" ref={ref} className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-[1360px] px-4 py-20 md:px-10 md:py-28">
        <h2 className="max-w-[18ch] font-wide text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.02] font-[720] tracking-[-0.02em] text-balance [font-stretch:112%]">
          One sentence in, <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">a working app</span> out.
        </h2>
        <div className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          <div className="absolute top-[15px] right-[16%] left-[16%] hidden h-px bg-border md:block" aria-hidden="true">
            <motion.div style={{ scaleX: fill }} className="h-full origin-left bg-primary" />
          </div>
          {STEPS.map((s) => (
            <div key={s.n} className="relative">
              <span className="relative z-10 grid size-8 place-items-center rounded-full border bg-background font-mono text-sm">{s.n}</span>
              <h3 className="mt-5 text-2xl font-semibold tracking-[-0.01em]">{s.title}</h3>
              <p className="mt-2 max-w-[34ch] leading-relaxed text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
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

// For the engineers reading: the actual architecture, with requests moving along it.
function HowItsBuilt() {
  const reduced = useReducedMotion()
  return (
    // `dark` scopes the dark palette to this band, so it reads as a change of room in either theme.
    <section id="built" className="dark scroll-mt-16 bg-background text-foreground">
      <div className="mx-auto max-w-[1360px] px-4 py-20 md:px-10 md:py-28">
        <h2 className="max-w-[18ch] font-wide text-[clamp(2rem,4.2vw,3.6rem)] leading-[1.02] font-[720] tracking-[-0.02em] text-balance [font-stretch:112%]">
          How it's <span className="font-display font-normal tracking-[-0.01em] italic [font-stretch:100%]">built</span>
        </h2>
        <p className="mt-5 max-w-[44rem] text-lg leading-relaxed text-muted-foreground">
          A learning project, written part by part: the agent loop, the sandbox, the event stream, persistence and the deploy are all hand-built rather than taken from a framework.
        </p>
        <div className="mt-12 hidden md:block"><Architecture animate={!reduced} /></div>
        <ol className="mt-10 space-y-5 border-l pl-6 md:hidden">
          {ARCH_LIST.map(([t, b]) => (
            <li key={t}><p className="font-semibold">{t}</p><p className="text-sm leading-relaxed text-muted-foreground">{b}</p></li>
          ))}
        </ol>
        <ul className="mt-12 flex flex-wrap gap-2">
          {STACK.map((s) => <li key={s} className="rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground">{s}</li>)}
        </ul>
        <a href={SOURCE} className="mt-10 inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-card">
          <GithubMark />Read the source on GitHub
        </a>
      </div>
    </section>
  )
}

const STACK = ['Bun', 'Elysia', 'React', 'Tailwind', 'Drizzle', 'Postgres', 'Better Auth', 'E2B', 'Redis', 'Cloudflare R2', 'GKE', 'Vercel']
const ARCH_LIST: [string, string][] = [
  ['Your browser', 'React on Vercel. Subscribes to the build as a stream of server-sent events.'],
  ['Orin API', 'Bun and Elysia on GKE. Runs the agent loop and owns one live session per project.'],
  ['The model', 'DeepSeek, OpenAI, Gemini or Claude, behind one small provider interface.'],
  ['E2B sandbox', 'A real Vite dev server per project. The preview is its public URL in an iframe.'],
  ['Postgres', 'The conversation, saved at the end of every round — never halfway through one.'],
  ['Redis → R2', 'Each round becomes a git bundle, queued and pushed to Cloudflare R2 for rewind.'],
]

// Nodes are HTML (crisp text at any size); the wires and moving packets are one SVG underneath.
// Both are laid out in the SVG's own 900×380 space — boxes are placed by converting those same
// coordinates to percentages — so a wire always ends at the box it points to.
const VB = { w: 900, h: 380 }
const NODES = {
  browser: { x: 120, y: 190, t: 'Your browser', s: 'React · Vercel' },
  api: { x: 460, y: 190, t: 'Orin API', s: 'Bun · Elysia · GKE' },
  llm: { x: 460, y: 62, t: 'The model', s: '4 providers, one interface' },
  sandbox: { x: 780, y: 110, t: 'E2B sandbox', s: 'Vite dev server' },
  pg: { x: 460, y: 318, t: 'Postgres', s: 'saved every round' },
  r2: { x: 780, y: 290, t: 'Redis → R2', s: 'git bundle per round' },
}
const WIRES: { d: string; label: string; lx: number; ly: number; anchor?: 'start' | 'middle'; dur: number }[] = [
  { d: 'M 208 190 L 372 190', label: 'server-sent events', lx: 290, ly: 180, anchor: 'middle', dur: 1.8 },
  { d: 'M 460 166 L 460 86', label: 'model calls', lx: 470, ly: 130, dur: 1.6 },
  { d: 'M 548 176 L 692 124', label: 'bash_tool', lx: 612, ly: 138, anchor: 'middle', dur: 1.7 },
  // the preview is loaded straight from the sandbox, not through the API — so it arcs over everything
  { d: 'M 150 166 Q 430 -118 692 96', label: 'live preview, straight from the sandbox', lx: 290, ly: 30, anchor: 'middle', dur: 3 },
  { d: 'M 460 214 L 460 294', label: 'every round', lx: 470, ly: 258, dur: 1.9 },
  { d: 'M 548 204 L 692 276', label: 'snapshot queue', lx: 612, ly: 256, anchor: 'middle', dur: 2.2 },
]

function Architecture({ animate }: { animate: boolean }) {
  return (
    <div className="relative mx-auto aspect-[900/380] w-full max-w-[1100px]">
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="absolute inset-0 h-full w-full overflow-visible text-border" aria-hidden="true">
        {WIRES.map((w) => (
          <g key={w.d}>
            <path d={w.d} fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 5" />
            <text x={w.lx} y={w.ly} textAnchor={w.anchor ?? 'start'} className="fill-muted-foreground font-mono text-[10.5px]">{w.label}</text>
            {animate && (
              <circle r="3.2" className="fill-primary">
                <animateMotion dur={`${w.dur}s`} repeatCount="indefinite" path={w.d} />
              </circle>
            )}
          </g>
        ))}
      </svg>
      {Object.values(NODES).map((n) => (
        <div key={n.t} className="absolute w-[19%] -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card px-3.5 py-3" style={{ left: `${(n.x / VB.w) * 100}%`, top: `${(n.y / VB.h) * 100}%` }}>
          <p className="text-sm font-semibold">{n.t}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{n.s}</p>
        </div>
      ))}
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
