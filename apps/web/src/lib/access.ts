import { useCallback, useEffect, useState } from 'react'
import { API, authed } from './api'

// Mirrors the API's AccessView (GET /me).
export type Access = {
  tier: string
  stepsLimit: number | null
  stepsUsed: number
  stepsLeft: number | null // null = unlimited
  expiresAt: string | null
  expired: boolean
}

// The signed-in account's access, with a refresh for when it changes under us (a step was
// spent, the budget ran out, the stream said access expired). `undefined` = still loading;
// `null` = the account has no access at all.
export function useAccess(signedIn: boolean) {
  const [access, setAccess] = useState<Access | null | undefined>(undefined)
  const refresh = useCallback(() => {
    fetch(`${API}/me`, authed)
      .then((res) => (res.ok ? res.json() : { access: null }))
      .then((body: { access: Access | null }) => setAccess(body.access))
      .catch(() => {}) // offline: keep what we had
  }, [])
  useEffect(() => {
    if (signedIn) refresh()
    else setAccess(undefined)
  }, [signedIn, refresh])
  return { access, refresh }
}

// "12 steps left" / "1 step left"; null when unlimited (nothing to show).
export function stepsLeftLabel(access: Access | null | undefined): string | null {
  if (!access || access.stepsLeft === null) return null
  return `${access.stepsLeft} ${access.stepsLeft === 1 ? 'step' : 'steps'} left`
}
