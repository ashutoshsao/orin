import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { postJSON } from '@/lib/api'
import { stepsLeftLabel, trialCleanupDate, type Access } from '@/lib/access'

export function RequestAccessButton({ access, onAccessChange }: { access: Access; onAccessChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [requestedVersion, setRequestedVersion] = useState<string | null>(null)
  const version = `${access.expiresAt}:${access.stepsLimit}`
  const requested = !!access.extensionRequestedAt || requestedVersion === version

  async function request() {
    if (busy || requested) return
    setBusy(true)
    try {
      const res = await postJSON('/access-request', {})
      if (!res.ok) { toast.error('Could not request more access. Refresh your access and try again.'); return }
      setRequestedVersion(version)
      onAccessChange()
      toast.success('Request sent. Check back here after it has been reviewed.')
    } catch { toast.error('Could not reach Orin. Try again.') }
    finally { setBusy(false) }
  }

  return <Button variant="outline" size="sm" disabled={busy || requested} onClick={() => void request()}>
    {requested ? 'Access requested' : busy ? 'Sending…' : 'Request more access'}
  </Button>
}

export function TrialNotice({ access, onAccessChange, compact = false }: {
  access: Access
  onAccessChange: () => void
  compact?: boolean
}) {
  if (access.stepsLimit === null) return null
  const cleanupDate = trialCleanupDate(access.expiresAt)
  return <div className={compact ? 'mt-2 space-y-1 px-1 text-xs text-muted-foreground' : 'mt-3 space-y-2 text-sm text-muted-foreground'}>
    <p className="font-mono text-xs">
      Trial · {stepsLeftLabel(access)}{access.expiresAt ? ` · ends ${new Date(access.expiresAt).toLocaleDateString()}` : ''}
    </p>
    {cleanupDate && <p>Project data is scheduled for cleanup from {cleanupDate}. Your account and usage history stay.</p>}
    {access.stepsLeft === 0 && <div className="space-y-2">
      <p>Your trial steps are used up. Request an extension to keep building; Orin’s owner reviews requests. Requesting does not delay project cleanup.</p>
      <RequestAccessButton access={access} onAccessChange={onAccessChange} />
    </div>}
  </div>
}
