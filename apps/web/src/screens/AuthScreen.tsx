import { useState } from 'react'
import { authClient } from '@/authClient'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/components/theme-toggle'

// Sign in / sign up. Accounts are invite-gated server-side, so a rejected sign-up is a
// normal outcome, not an edge case — the error is shown plainly rather than as an alarm.
export function AuthScreen() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = mode === 'in'
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name })
    setBusy(false)
    if (res.error) setError(res.error.message ?? 'Something went wrong.')
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-6">
      <div className="absolute top-5 right-6"><ThemeToggle /></div>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Orin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe an app. Watch it get built.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {mode === 'up' && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === 'in' ? "Don't have an account? " : 'Already have one? '}
          <button
            type="button"
            className="text-foreground underline underline-offset-4 hover:no-underline"
            onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null) }}
          >
            {mode === 'in' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
