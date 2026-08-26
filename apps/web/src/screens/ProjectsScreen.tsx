import { useEffect, useState } from 'react'
import { ArrowUp, LogOut } from 'lucide-react'
import { authClient } from '@/authClient'
import { API, authed, postJSON, timeAgo, type Project } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

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
      <header className="flex items-center justify-between px-6 py-5">
        <span className="font-semibold tracking-tight">Orin</span>
        <Button variant="ghost" size="sm" onClick={() => authClient.signOut()}>
          <LogOut /> Sign out
        </Button>
      </header>

      <section className="mx-auto flex min-h-[62vh] max-w-2xl flex-col justify-center px-6 text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          What should we build?
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance text-sm text-muted-foreground">
          Describe it in a sentence. You can refine it as it comes together.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); create() }}
          className="mt-8 rounded-xl border bg-card text-left shadow-xs transition-colors focus-within:border-ring"
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create() }}
            rows={3}
            autoFocus
            placeholder="A todo app with filters and dark mode…"
            className="w-full resize-none bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between px-3 pb-3">
            <span className="text-xs text-muted-foreground">⌘↵ to start</span>
            <Button type="submit" size="sm" disabled={!prompt.trim() || creating}>
              {creating ? 'Starting…' : <>Build <ArrowUp /></>}
            </Button>
          </div>
        </form>
      </section>

      {projects === null && (
        <div className="mx-auto max-w-2xl space-y-2 px-6 pb-16">
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      )}

      {projects && projects.length > 0 && (
        <section className="mx-auto max-w-2xl px-6 pb-20">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your projects
          </h2>
          <ul className="mt-3 divide-y rounded-lg border">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => onOpen(p)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(p.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
