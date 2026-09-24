import { motion } from 'motion/react'
import type { AppTrouble } from '@/lib/events'
import { cn } from '@/lib/utils'

// Covers the preview while the generated app doesn't compile.
//
// Without it the user reads Vite's red error overlay — a stack trace for a mistake the agent is
// already fixing, which makes Orin look broken rather than the app being built. The agent gets the
// error (it's the one that can act on it); the person watching gets a sentence. Opaque, not a blur:
// a half-legible stack trace behind frosted glass is worse than hiding it outright.
export function PreviewTrouble({ state }: { state: AppTrouble }) {
  const fixing = state === 'fixing'
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="absolute inset-0 z-10 grid place-items-center bg-card"
      role="status"
    >
      <div className="flex max-w-[16rem] flex-col items-center gap-3 px-6 text-center">
        {/* Same dot as the status bar: pulsing means work is happening, still means it stopped. */}
        <span
          className={cn(
            'size-1.5 rounded-full bg-primary',
            fixing && 'animate-pulse shadow-[0_0_0_4px] shadow-primary/20',
          )}
        />
        <p className="text-sm text-foreground/80">
          {fixing ? 'Fixing an error in your app' : "Couldn't get the preview working"}
        </p>
        <p className="text-balance text-xs text-muted-foreground">
          {fixing
            ? 'The preview comes back on its own once it builds.'
            : 'Tell me what the app should do and I’ll try again.'}
        </p>
      </div>
    </motion.div>
  )
}
