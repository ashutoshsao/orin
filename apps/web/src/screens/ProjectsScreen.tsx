import { useEffect, useState } from 'react'
import { ArrowUp, LogOut } from 'lucide-react'
import { authClient } from '@/authClient'
import { API, authed, postJSON, timeAgo, type Project } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// Home: the composer is the primary action (this is a builder, so "describe an app" is
// the job), with saved projects listed beneath it.
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

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const text = prompt.trim()
    if (!text || creating) return
    setCreating(true)
    const res = await postJSON('/projects', { name: text.slice(0, 60) })
    setCreating(false)
    if (res.ok) onOpen(await res.json(), text) // hand off to the builder with the first prompt
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-2xl items-center justify-between px-6 py-5">
        <span className="font-semibold tracking-tight">Orin</span>
        <Button variant="ghost" size="sm" onClick={() => authClient.signOut()}>
          <LogOut /> Sign out
        </Button>
      </header>

      <main className="mx-auto max-w-2xl px-6 pb-20">
        <h1 className="mt-8 text-2xl font-semibold tracking-tight">What should we build?</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe it in a sentence. You can refine it as it comes together.
        </p>

        <form onSubmit={create} className="mt-5">
          <div className="relative rounded-xl border bg-card shadow-xs transition-colors focus-within:border-ring">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(e) }}
              rows={3}
              placeholder="A todo app with filters and dark mode…"
              className="w-full resize-none bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between px-3 pb-3">
              <span className="text-xs text-muted-foreground">⌘↵ to start</span>
              <Button type="submit" size="sm" disabled={!prompt.trim() || creating}>
                {creating ? 'Starting…' : <>Build <ArrowUp /></>}
              </Button>
            </div>
          </div>
        </form>

        <section className="mt-12">
          <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Projects</h2>
          <div className="mt-3">
            {projects === null && (
              <div className="space-y-2">
                {[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
              </div>
            )}
            {projects?.length === 0 && (
              <p className="py-6 text-sm text-muted-foreground">
                Nothing here yet — your first build will show up in this list.
              </p>
            )}
            <ul className="divide-y rounded-lg border">
              {projects?.map((p) => (
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
          </div>
        </section>
      </main>
    </div>
  )
}
