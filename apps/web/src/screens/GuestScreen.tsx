import { useEffect, useState } from 'react'
import { API } from '@/lib/api'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wordmark } from '@/components/brand'

// /g/<token> — a guest link (7c). There's no screen to fill in: we exchange the token for a
// one-time sign-in URL and follow it, which is where the session cookie gets set. Reusable,
// so reopening it on another device lands in the same account.
export function GuestScreen({ token }: { token: string }) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch(`${API}/g/${token}`, { method: 'POST', credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { verifyUrl?: string } | null) => {
        if (body?.verifyUrl) window.location.replace(body.verifyUrl)
        else setFailed(true)
      })
      .catch(() => setFailed(true))
  }, [token])

  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-6">
      <div className="absolute top-5 right-6"><ThemeToggle /></div>
      <div className="w-full max-w-sm text-center">
        <Wordmark className="justify-center" />
        {failed ? (
          <>
            <h1 className="mt-10 font-display text-3xl leading-tight font-normal">This link isn't active</h1>
            <p className="mt-3 text-balance text-sm text-muted-foreground">
              It may have expired or been turned off. Ask for a new one.
            </p>
          </>
        ) : (
          <p className="mt-10 text-sm text-muted-foreground">Signing you in…</p>
        )}
      </div>
    </div>
  )
}
