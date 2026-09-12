import { useEffect, useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { API, authed, postJSON, timeAgo } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wordmark } from '@/components/brand'

// /admin (7g) — the two things done often enough to want a button: hand someone a guest
// link, and invite an allowlisted person by email. Everything here is reversible; deleting
// data stays a CLI (`prune-guests`), so there's nothing destructive on this page.
type GuestLink = { id: string; label: string | null; expiresAt: string; revokedAt: string | null; stepsUsed: number; stepsLimit: number | null }
type UsageRow = { userId: string; email: string; tier: string; stepsUsed: number; stepsLimit: number | null; expiresAt: string | null; projects: number; lastActive: string | null }
type Overview = { guests: GuestLink[]; usage: UsageRow[] }

export function AdminScreen() {
  const [data, setData] = useState<Overview | null | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [fresh, setFresh] = useState<{ url: string; kind: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const load = () =>
    fetch(`${API}/admin/overview`, authed)
      .then((res) => (res.ok ? res.json() : null))
      .then(setData)
      .catch(() => setData(null))
  useEffect(() => { load() }, [])

  async function copy(url: string) {
    await navigator.clipboard.writeText(url).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  async function newGuestLink() {
    setBusy(true)
    const res = await postJSON('/admin/guest-links', { label: label.trim() || undefined })
    setBusy(false)
    if (!res.ok) { toast.error('Could not create that link.'); return }
    const { url } = (await res.json()) as { url: string }
    setFresh({ url, kind: 'guest' }); setLabel(''); copy(url); load()
    toast.success('Guest link created', { description: 'Copied to your clipboard.' })
  }

  async function newInviteLink(kind: 'invite' | 'reset') {
    setBusy(true)
    const res = await postJSON('/admin/invite-links', { email: email.trim(), kind })
    setBusy(false)
    const body = (await res.json()) as { url?: string; error?: string }
    if (!res.ok || !body.url) { toast.error(body.error ?? 'Could not create that link.'); return }
    setFresh({ url: body.url, kind }); setEmail(''); copy(body.url)
    toast.success(`${kind === 'reset' ? 'Reset' : 'Invite'} link created`, { description: 'Copied to your clipboard.' })
  }

  async function revoke(id: string) {
    const res = await postJSON(`/admin/guest-links/${id}/revoke`, {})
    if (!res.ok) { toast.error('Could not revoke that link.'); return }
    toast.success('Link revoked')
    load()
  }

  if (data === undefined) {
    return (
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <Skeleton className="h-10 w-48 rounded-lg" />
      </div>
    )
  }
  if (data === null) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background px-6 text-center">
        <div>
          <Wordmark className="justify-center" />
          <h1 className="mt-8 font-display text-3xl font-normal">Not your page</h1>
          <p className="mt-2 text-sm text-muted-foreground">This account isn't an admin.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Wordmark />
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">admin</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 pb-24">
        <h1 className="font-display text-4xl leading-tight font-normal">Give someone access</h1>

        <section className="mt-8 rounded-2xl border bg-card p-5">
          <h2 className="text-[13px] tracking-[0.08em] text-muted-foreground uppercase">Guest link</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Reusable, 60 steps, 7 days. Everyone who opens it shares one account.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Who is it for? (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Button className="rounded-lg" disabled={busy} onClick={newGuestLink}>
              <Link2 /> Create link
            </Button>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border bg-card p-5">
          <h2 className="text-[13px] tracking-[0.08em] text-muted-foreground uppercase">Invite by email</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            One-time link, 48 hours. Unlimited access — for people you know.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="rounded-lg" disabled={busy || !email.includes('@')} onClick={() => newInviteLink('invite')}>
              Invite
            </Button>
            <Button variant="outline" className="rounded-lg" disabled={busy || !email.includes('@')} onClick={() => newInviteLink('reset')}>
              Reset password
            </Button>
          </div>
        </section>

        {fresh && (
          <button
            onClick={() => copy(fresh.url)}
            className="mt-4 flex w-full items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-left transition-colors hover:border-ring"
          >
            {copied ? <Check className="size-4 shrink-0 text-primary" /> : <Copy className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate font-mono text-xs">{fresh.url}</span>
          </button>
        )}

        <section className="mt-12">
          <h2 className="text-[13px] tracking-[0.08em] text-muted-foreground uppercase">Guest links</h2>
          {data.guests.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">None yet — create one above.</p>
          ) : (
            <ul className="mt-2.5 border-y">
              {data.guests.map((g) => {
                const state = g.revokedAt ? 'revoked' : new Date(g.expiresAt) < new Date() ? 'expired' : 'active'
                return (
                  <li key={g.id} className="flex items-center justify-between gap-4 border-t py-3 first:border-t-0">
                    <div className="min-w-0">
                      <p className="truncate text-[15px]">{g.label ?? 'Guest'}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {state} · {g.stepsUsed}/{g.stepsLimit ?? '∞'} steps · {state === 'active' ? 'ends' : 'ended'} {new Date(g.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    {state === 'active' && (
                      <Button variant="ghost" size="xs" className="shrink-0" onClick={() => revoke(g.id)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="mt-12">
          <h2 className="text-[13px] tracking-[0.08em] text-muted-foreground uppercase">Accounts</h2>
          <ul className="mt-2.5 border-y">
            {data.usage.map((u) => (
              <li key={u.userId} className="flex items-center justify-between gap-4 border-t py-3 first:border-t-0">
                <div className="min-w-0">
                  <p className="truncate text-[15px]">{u.email}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {u.tier} · {u.stepsUsed}/{u.stepsLimit ?? '∞'} steps · {u.projects} projects
                    {u.lastActive ? ` · active ${timeAgo(u.lastActive)}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  )
}
