import { useEffect, useState } from 'react'
import { authClient } from '@/authClient'
import { API, authed, postJSON, timeAgo, type Project } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ThemeToggle } from '@/components/theme-toggle'
import { Kbd, Wordmark } from '@/components/brand'

// Home is the "describe an app" moment, not a dashboard: the composer is centered and
// given the viewport, with saved projects kept quietly below it (and absent entirely
// until there are some, so a first-time user sees only the one thing to do).
export function ProjectsScreen({ onOpen }: { onOpen: (p: Project, firstPrompt?: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [prompt, setPrompt] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${API}/projects`, authed)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: Project[]) => alive && setProjects(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setProjects([]))
    return () => { alive = false }
  }, [])

  async function create() {
    const text = prompt.trim()
    if (!text || creating) return
    setCreating(true)
    const res = await postJSON('/projects', { name: text.slice(0, 60) })
    setCreating(false)
    if (res.ok) onOpen(await res.json(), text) // hand off to the builder with the first prompt
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between px-6 py-6 sm:px-12 sm:py-7">
        <Wordmark />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => authClient.signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <section className="mx-auto flex max-w-[680px] flex-col items-center px-6 pt-16 text-center sm:pt-24">
        {/* Instrument Serif ships one weight — keep it font-normal so the browser never fakes a bold. */}
        <h1 className="text-balance font-display text-5xl leading-none font-normal tracking-[-0.02em] sm:text-7xl lg:text-[78px]">
          What should we <em className="text-primary">build</em>?
        </h1>
        <p className="mt-5 text-balance text-base text-muted-foreground">
          Describe it in a sentence. You'll refine it as it comes together.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); create() }}
          className="mt-11 w-full rounded-[18px] border bg-card text-left shadow-[0_1px_0_rgb(28_24_20/0.04),0_18px_40px_-18px_rgb(60_40_20/0.28)] transition-colors focus-within:border-ring dark:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.8)]"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create() }}
            rows={3}
            autoFocus
            placeholder="A habit tracker with streaks and a calm weekly view…"
            className="w-full resize-none bg-transparent px-6 pt-5 pb-2 text-[17px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
          />
          <div className="flex items-center justify-end gap-2.5 px-3.5 pb-3.5">
            <span className="flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>↵</Kbd></span>
            <Button type="submit" className="rounded-lg px-3.5 font-semibold" disabled={!prompt.trim() || creating}>
              {creating ? 'Starting…' : 'Build'}
            </Button>
          </div>
        </form>
      </section>

      {projects === null && (
        <div className="mx-auto mt-16 max-w-[680px] px-6">
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      )}

      {projects && projects.length > 0 && (
        <section className="mx-auto mt-16 max-w-[680px] px-6 pb-20 sm:mt-20">
          <h2 className="text-[11px] tracking-[0.1em] text-muted-foreground uppercase">Recent</h2>
          <ul className="mt-2.5 border-y">
            {projects.map((p) => (
              <li key={p.id} className="border-t first:border-t-0">
                <button
                  onClick={() => onOpen(p)}
                  className="flex w-full items-baseline justify-between gap-4 px-0.5 py-[15px] text-left transition-colors hover:text-primary"
                >
                  <span className="truncate text-[15px]">{p.name}</span>
                  <span className="shrink-0 text-[13px] text-muted-foreground">{timeAgo(p.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
