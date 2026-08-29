import { cn } from '@/lib/utils'

// The Orin mark: a circle split by one stroke. Draws in currentColor, so it takes the
// theme's accent (clay in light, lime in dark) wherever it's placed with text-primary.
export function OrinMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className={cn('size-[22px]', className)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <OrinMark className="text-primary" />
      <span className="font-display text-[27px] leading-none tracking-[-0.01em]">Orin</span>
    </span>
  )
}

// A keyboard key, as in "⌘ ↵" hints — raised by a slightly heavier bottom border.
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-b-2 px-1.5 py-px font-mono text-[11px] leading-4 text-muted-foreground">
      {children}
    </kbd>
  )
}
