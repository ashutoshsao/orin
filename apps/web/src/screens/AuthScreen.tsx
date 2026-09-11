import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { authClient } from '@/authClient'
import { API, authed } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'
import { GithubMark, Wordmark } from '@/components/brand'

// One way in for everyone (7b): GitHub for visitors, and a quiet email link for the few
// people invited by address. There's no sign-up form — email accounts are created only
// through a one-time invite link, so knowing an invited address isn't enough.
export function AuthScreen() {
  const [github, setGithub] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`${API}/config`, authed)
      .then((res) => res.json())
      .then((c: { github?: boolean }) => setGithub(!!c.github))
      .catch(() => {})
  }, [])

  async function signInEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await authClient.signIn.email({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (res.error) setError(res.error.message ?? 'That email and password did not match.')
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-6">
      <div className="absolute top-5 right-6"><ThemeToggle /></div>
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Wordmark className="justify-center" />
          <p className="mt-4 text-balance text-[15px] text-muted-foreground">
            Describe an app. Watch it get built.
          </p>
        </div>

        {github && (
          <Button
            className="mt-9 w-full rounded-xl"
            size="lg"
            onClick={() => authClient.signIn.social({ provider: 'github', callbackURL: window.location.origin })}
          >
            <GithubMark /> Continue with GitHub
          </Button>
        )}

        {!showEmail ? (
          <button
            onClick={() => setShowEmail(true)}
            className="mt-6 w-full text-center text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Invited by email? Sign in →
          </button>
        ) : (
          <form onSubmit={signInEmail} className={github ? 'mt-8 space-y-4 border-t pt-8' : 'mt-9 space-y-4'}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={reveal ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors hover:text-foreground"
                >
                  {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full rounded-xl" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-center text-[13px] text-muted-foreground">
              Forgotten your password? Ask for a new link.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
