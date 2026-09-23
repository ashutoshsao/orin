import { describe, expect, test } from 'bun:test'
import { runStatus } from './events'
import type { AgentEvent } from './api'

// Live events carry a sessionId; replayed history doesn't, and must not drive the status bar.
const ev = (event: string, extra: Record<string, unknown> = {}): AgentEvent =>
  ({ ts: '', sessionId: 's1', event, ...extra }) as AgentEvent
const replayed = (event: string): AgentEvent => ({ ts: '', sessionId: '', event }) as AgentEvent

const opts = { pending: false, hasPreview: true, online: true }

describe('runStatus with a broken app', () => {
  // The regression this exists for: Vite keeps serving a 200 while showing its error overlay,
  // so the bar used to say "preview · live" over a stack trace.
  test('never says live while the app fails to compile', () => {
    const s = runStatus([ev('run_start'), ev('final'), ev('preview_error')], opts)
    expect(s.label).toBe('needs a fix')
    expect(s.active).toBe(false)
  })

  test('mid-run it says what is happening, not a step number', () => {
    const s = runStatus([ev('run_start'), ev('preview_error'), ev('llm_call', { iteration: 4 })], opts)
    expect(s).toEqual({ label: 'fixing an error', active: true, building: true })
  })

  test('recovery puts it back to live', () => {
    const s = runStatus([ev('run_start'), ev('preview_error'), ev('preview_recovered'), ev('final')], opts)
    expect(s.label).toBe('preview · live')
  })

  test('exhausted repairs still read as broken', () => {
    const s = runStatus([ev('run_start'), ev('preview_failed'), ev('final')], opts)
    expect(s.label).toBe('needs a fix')
  })

  // Reopening a project restores files and starts a fresh sandbox; a stale error from the
  // previous session must not brand the restored app broken.
  test('a restore clears an earlier error', () => {
    const s = runStatus([ev('preview_error'), ev('snapshot_restored'), ev('run_start'), ev('final')], opts)
    expect(s.label).toBe('preview · live')
  })

  test('replayed history does not drive the bar', () => {
    const s = runStatus([replayed('preview_error'), ev('run_start'), ev('final')], opts)
    expect(s.label).toBe('preview · live')
  })

  test('offline still wins over everything', () => {
    const s = runStatus([ev('preview_error')], { ...opts, online: false })
    expect(s.label).toBe('offline')
  })
})
