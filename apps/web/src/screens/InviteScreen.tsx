import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { authClient } from '@/authClient'
import { API } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wordmark } from '@/components/brand'

// /invite/<token> — set the first password (invite) or replace a forgotten one (reset).
// The token in the URL is the whole credential, so the email is fixed by the server and
// never typed here. On success we sign in with what was just set and land on home.
export function InviteScreen({ token }: { token: string }) {
  const [link, setLink] = useState<{ email: string; kind: string } | null | undefined>(undefined)
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`${API}/invite/${token}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setLink)
      .catch(() => setLink(null))
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!link) return
    setBusy(true); setError(null)
    const res = await fetch(`${API}/invite/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      setBusy(false)
      setError(((await res.json()) as { error?: string }).error ?? 'Could not use this link.')
      return
    }
    const signedIn = await authClient.signIn.email({ email: link.email, password })
    setBusy(false)
    if (signedIn.error) { setError('Password set — please sign in.'); return }
    window.history.replaceState({}, '', '/') // drop the token from the URL
    window.location.reload()
  }

  const isReset = link?.kind === 'reset'
  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-6">
      <div className="absolute top-5 right-6"><ThemeToggle /></div>
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Wordmark className="justify-center" />
        </div>

        {link === undefined ? (
          <p className="mt-9 text-center text-sm text-muted-foreground">Checking your link…</p>
        ) : link === null ? (
          <div className="mt-9 text-center">
            <h1 className="font-display text-3xl leading-tight font-normal">This link has expired</h1>
            <p className="mt-3 text-balance text-sm text-muted-foreground">
              Invite links last 48 hours and work once. Ask for a new one.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-9 space-y-4">
            <div>
              <h1 className="font-display text-3xl leading-tight font-normal">
                {isReset ? 'Choose a new password' : 'Set your password'}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">{link.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={reveal ? 'text' : 'password'}
                  autoFocus
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                {/* Shown by default on this screen: a typo here locks you out of the account. */}
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-[13px] text-muted-foreground">At least 8 characters.</p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full rounded-xl" disabled={busy || password.length < 8}>
              {busy ? 'Setting up…' : isReset ? 'Save password' : 'Set password and start'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
