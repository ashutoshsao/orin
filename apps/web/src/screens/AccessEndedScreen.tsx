import { authClient } from '@/authClient'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { Wordmark } from '@/components/brand'

// Shown instead of home when a signed-in account's access has expired (or it has none).
// Expired trial data is retained for seven more days before scheduled cleanup.
export function AccessEndedScreen({ expired }: { expired: boolean }) {
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
            ? 'Thanks for trying Orin. Your access has expired. Trial apps and saved data are scheduled for deletion seven days after expiry.'
            : "This account isn't set up to build with Orin."}
        </p>
        <Button variant="outline" className="mt-8" onClick={() => authClient.signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
