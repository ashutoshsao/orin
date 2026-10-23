import { useState } from 'react'
import { Check, ChevronRight, Copy, ExternalLink, Globe, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { AgentEvent } from '@/lib/api'
import { bareHost, finalSlug, isSlug, slugInput, type DeployInfo } from '@/lib/deploy'
import { cn } from '@/lib/utils'

// The publish control in the preview bar. Four states, one place:
//   not published  → "Publish"
//   publishing     → "Publishing…" (disabled)
//   published      → the link
//   edits since    → the link + "Update"
export function PublishControl({ info, publishing, outdated, disabled, onPublish, onUnpublish }: {
  info: DeployInfo
  publishing: boolean
  outdated: boolean
  disabled: boolean
  onPublish: () => void
  onUnpublish: () => void
}) {
  if (publishing) {
    return (
      <Button variant="ghost" size="xs" disabled className="gap-1.5 font-mono">
        <LoaderCircle className="animate-spin" /> Publishing…
      </Button>
    )
  }
  if (!info.deployUrl) {
    return (
      <Button variant="outline" size="xs" className="gap-1.5" disabled={disabled} onClick={onPublish}>
        <Globe /> Publish
      </Button>
    )
  }
  return (
    <div className="flex min-w-0 items-center gap-1">
      <a
        href={info.deployUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="truncate rounded-sm px-1.5 font-mono text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        title="Open the published app"
      >
        {bareHost(info.deployUrl)}
      </a>
      <CopyButton text={info.deployUrl} />
      <Button variant="ghost" size="icon-xs" aria-label="Open published app" onClick={() => window.open(info.deployUrl!, '_blank', 'noopener')}><ExternalLink /></Button>
      <Button variant="ghost" size="xs" disabled={disabled} onClick={onUnpublish}>Unpublish</Button>
      {outdated && (
        <Button variant="outline" size="xs" disabled={disabled} onClick={onPublish} title="Publish your latest changes">
          Update
        </Button>
      )}
    </div>
  )
}

// First publish only: the link's name is the user's to type — never a guess they didn't see.
// The example is a placeholder, not a value; the suffix is fixed and shown, so what they read
// is exactly the address they get.
export function PublishDialog({ info, open, onOpenChange, onPublish }: {
  info: DeployInfo
  open: boolean
  onOpenChange: (open: boolean) => void
  // Resolves to an error to show, or null when publishing started.
  onPublish: (slug: string) => Promise<string | null>
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const slug = finalSlug(value)
  const valid = isSlug(slug)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!valid || sending) return
    setSending(true)
    const err = await onPublish(slug)
    setSending(false)
    if (err) setError(err)
    else { setValue(''); setError(null) }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setError(null) }}>
      <AlertDialogContent>
        <form onSubmit={submit} className="contents">
          <AlertDialogHeader>
            <AlertDialogTitle>Name your app’s link</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with the link can open the app. The name can’t be changed after publishing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <InputGroup className={cn('rounded-lg', error && 'border-destructive')}>
              <InputGroupInput
                value={value}
                onChange={(e) => { setValue(slugInput(e.target.value)); setError(null) }}
                placeholder={info.example ?? 'coffee-shop'}
                aria-label="Link name"
                aria-invalid={error !== null}
                aria-describedby="publish-name-help"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText className="font-mono text-xs">-{info.suffix}.vercel.app</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <p id="publish-name-help" className={cn('text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
              {error ?? 'Lowercase letters, numbers and dashes.'}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" disabled={!valid || sending}>
              {sending ? 'Starting…' : 'Publish'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// A publish's outcome in the feed: the live link, or why it didn't work — with the end of the
// build log folded away for whoever wants it.
export function DeployResult({ event }: { event: AgentEvent }) {
  if (event.event === 'deploy_ready' && typeof event.url === 'string') {
    return (
      <div className="rounded-xl border bg-card px-3.5 py-2.5">
        <p className="text-[13px] text-muted-foreground">Published{event.slow ? ' · the link may take a moment' : ''}</p>
        <div className="mt-1 flex items-center gap-1">
          <a href={event.url} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-[14px] text-foreground underline-offset-4 hover:underline">
            {bareHost(event.url)}
          </a>
          <CopyButton text={event.url} />
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Open the published app" onClick={() => window.open(String(event.url), '_blank', 'noopener')}>
            <ExternalLink />
          </Button>
        </div>
      </div>
    )
  }
  const log = typeof event.log === 'string' ? event.log : ''
  return (
    <div className="rounded-xl border border-dashed px-3.5 py-2.5">
      <p className="text-[15px]">Publishing didn’t work.</p>
      <p className="mt-0.5 text-[13px] text-muted-foreground">{String(event.message ?? 'The build failed.')}</p>
      {log && (
        <Collapsible className="mt-2">
          <CollapsibleTrigger className="group flex items-center gap-1.5 font-mono text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronRight className="size-3 transition-transform group-aria-expanded:rotate-90" /> build log
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-muted p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{log}</pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="text-muted-foreground"
      aria-label={copied ? 'Copied' : 'Copy link'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
      }}
    >
      {copied ? <Check /> : <Copy />}
    </Button>
  )
}

export function UnpublishDialog({ open, onOpenChange, onConfirm }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<string | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return <AlertDialog open={open} onOpenChange={(next) => { if (!busy) { setError(null); onOpenChange(next) } }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Unpublish this app?</AlertDialogTitle>
        <AlertDialogDescription>The public app and its hosted versions will be removed. Your code, chat and sandbox preview stay here. You can publish again, but the same address may no longer be available.</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
        <Button variant="destructive" disabled={busy} onClick={async () => {
          setBusy(true)
          try {
            const message = await onConfirm()
            if (message) setError(message)
            else onOpenChange(false)
          } catch { setError('Could not unpublish. Try again.') }
          finally { setBusy(false) }
        }}>{busy ? 'Unpublishing…' : 'Unpublish'}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
