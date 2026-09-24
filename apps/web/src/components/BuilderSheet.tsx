import type { ReactNode } from 'react'
import { useState } from 'react'
import { Drawer } from 'vaul'
import type { RunStatus } from '@/lib/events'
import { cn } from '@/lib/utils'

// Two snap points, not three. Peek keeps the composer and the last line of the conversation in
// reach while the preview stays the screen; full is for reading back through a long build.
const PEEK = 0.32
const FULL = 0.94
const SNAP_POINTS = [PEEK, FULL]

// The chat on a phone. Deliberately NOT dismissible: the composer is the only way to talk to the
// agent, so a sheet you can swipe away entirely leaves the user stuck behind a preview with no
// visible way back. Peek is as small as it gets.
//
// `modal={false}` matters too — the preview behind stays scrollable and tappable, which is the
// point of putting it in front.
export function BuilderSheet({ status, composer, children }: {
  status: RunStatus
  // Rendered ABOVE the conversation here, unlike the desktop column. A snap sheet reveals its own
  // top edge, so anything that must be usable at peek has to live there — and on a phone the one
  // thing that must always be usable is the box you type in.
  composer: ReactNode
  children: ReactNode
}) {
  const [snap, setSnap] = useState<number | string | null>(PEEK)

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-30 flex h-[94dvh] flex-col rounded-t-[20px] border-t bg-background shadow-[0_-16px_40px_-24px_rgb(60_40_20/0.45)] outline-none dark:shadow-[0_-16px_40px_-20px_rgb(0_0_0/0.9)]"
          aria-describedby={undefined}
        >
          {/* The grab handle is the whole affordance — it has to read as draggable at a glance. */}
          <div className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2.5 active:cursor-grabbing">
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>
          <Drawer.Title className="sr-only">Conversation</Drawer.Title>

          {/* At peek the header is scrolled out of view, so carry the status here instead —
              otherwise a phone user has no idea whether anything is happening. */}
          <div
            className={cn(
              'flex shrink-0 items-center gap-2 px-5 pb-2 font-mono text-xs transition-opacity',
              snap === FULL && 'pointer-events-none opacity-0',
            )}
          >
            <span className={cn('size-1.5 rounded-full bg-primary', status.active && 'animate-pulse shadow-[0_0_0_4px] shadow-primary/20')} />
            <span className="text-foreground/80">{status.label}</span>
          </div>

          <div className="shrink-0">{composer}</div>
          {/* The conversation only earns space once the sheet is dragged up; at peek it's below
              the fold, which is the right priority on a screen this size. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
