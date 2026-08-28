import { useSyncExternalStore } from 'react'

// Light = warm editorial, dark = studio. The user toggles; the first visit follows the
// OS, and after that the choice is remembered. index.html applies the same logic in an
// inline script before first paint, so there's no flash of the wrong theme.
export type Theme = 'light' | 'dark'

const KEY = 'orin-theme'

function readInitial(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage blocked — fall through to the OS */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let current: Theme = readInitial()
const listeners = new Set<() => void>()

function apply(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}
apply(current)

export function setTheme(theme: Theme) {
  current = theme
  apply(theme)
  try { localStorage.setItem(KEY, theme) } catch { /* not persisted — still applied */ }
  listeners.forEach((notify) => notify())
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(
    (notify) => { listeners.add(notify); return () => listeners.delete(notify) },
    () => current,
  )
  return [theme, setTheme]
}
