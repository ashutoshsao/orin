import { authClient } from '@/authClient'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wordmark } from '@/components/brand'
import { RequestAccessButton } from '@/components/TrialNotice'
import { trialCleanupDate, type Access } from '@/lib/access'

// Shown instead of home when a signed-in account's access has expired (or it has none).
// Expired trial data is retained for seven more days before scheduled cleanup.
export function AccessEndedScreen({ access, onAccessChange }: { access: Access | null; onAccessChange: () => void }) {
  const expired = !!access?.expired
  const purged = !!(access?.dataPurgedAt && access.expiresAt && new Date(access.dataPurgedAt) >= new Date(access.expiresAt))
  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-6">
      <div className="absolute top-5 right-6"><ThemeToggle /></div>
      <div className="w-full max-w-sm text-center">
        <Wordmark className="justify-center" />
        <h1 className="mt-10 text-balance font-display text-4xl leading-tight font-normal">
          {expired ? 'Your trial has ended' : 'No access yet'}
        </h1>
        <p className="mt-3 text-balance text-sm text-muted-foreground">
          {expired
            ? purged
              ? 'Your trial project data has been removed. Your account and usage history are retained.'
              : `Your trial has ended. Project data is scheduled for cleanup from ${trialCleanupDate(access?.expiresAt ?? null) ?? 'seven days after expiry'}. Your account and usage history stay.`
            : "This account isn't set up to build with Orin."}
        </p>
        {access && expired && <div className="mt-5 space-y-3">
          <p className="text-sm text-muted-foreground">Request an extension to keep building. Orin’s owner reviews requests. Requesting does not delay cleanup, and removed projects won’t return.</p>
          <RequestAccessButton access={access} onAccessChange={onAccessChange} />
          <Button variant="ghost" size="sm" onClick={onAccessChange}>Refresh access</Button>
        </div>}
        <Button variant="outline" className="mt-8" onClick={() => authClient.signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
