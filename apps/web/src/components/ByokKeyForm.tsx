import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { API, authed, postJSON } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

type ModelChoice = { id: string; label: string; unverified?: boolean }
type ProviderChoice = { id: string; label: string; models: ModelChoice[] }

// Visitors build with their own API key (7f). The key is sent once, checked with a tiny call,
// and kept in the server's memory for this session only — never stored, so this asks again
// after a restart. Suggested models are fast/flash tier first: an agent loop makes many small
// calls, where speed matters more than depth.
export function ByokKeyForm({ onSaved }: { onSaved: () => void }) {
  const [providers, setProviders] = useState<ProviderChoice[]>([])
  const [provider, setProvider] = useState('deepseek')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${API}/config`, authed)
      .then((res) => res.json())
      .then((c: { providers?: ProviderChoice[] }) => setProviders(c.providers ?? []))
      .catch(() => {})
  }, [])

  const chosen = providers.find((p) => p.id === provider)
  const models = chosen?.models ?? []

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const res = await postJSON('/byok', { provider, apiKey: apiKey.trim(), model: model.trim() || models[0]?.id })
    setBusy(false)
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'That key was rejected.')
      return
    }
    setApiKey('')
    onSaved()
  }

  return (
    <form onSubmit={save} className="w-full rounded-[18px] border bg-card p-5 text-left">
      <p className="flex items-center gap-2 text-[15px] font-medium">
        <KeyRound className="size-4 text-primary" /> Add an API key to start
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Orin builds with your key and never stores it — it's held for this session only.
      </p>

      {/* One provider is always chosen: pressing the chosen one again (an empty value) is ignored. */}
      <ToggleGroup
        aria-label="Provider"
        value={[provider]}
        onValueChange={(v) => { if (v[0]) { setProvider(v[0]); setModel('') } }}
        variant="primary"
        size="sm"
        spacing={1.5}
        className="mt-4 flex-wrap"
      >
        {providers.map((p) => <ToggleGroupItem key={p.id} value={p.id}>{p.label}</ToggleGroupItem>)}
      </ToggleGroup>

      <div className="mt-3 space-y-2">
        <Input
          type="password"
          autoComplete="off"
          aria-label="API key"
          placeholder="Paste your API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <Input
          aria-label="Model"
          placeholder={models[0] ? `Model (default: ${models[0].id})` : 'Model name'}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
        {models.length > 0 && (
          // Suggestions for the box above: one is pressed when it's what the box says; none when typed by hand.
          <ToggleGroup
            aria-label="Suggested models"
            value={model ? [model] : []}
            onValueChange={(v) => setModel(v[0] ?? '')}
            variant="outline"
            size="sm"
            spacing={1.5}
            className="flex-wrap"
          >
            {models.map((m) => (
              <ToggleGroupItem key={m.id} value={m.id} className="h-6 px-2 font-mono text-[11px] text-muted-foreground aria-pressed:text-foreground">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      <Button type="submit" className="mt-4 w-full" disabled={busy || apiKey.trim().length < 8}>
        {busy ? 'Checking the key…' : 'Start building'}
      </Button>
    </form>
  )
}
