import { useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { authClient } from './authClient'
import { Toaster } from '@/components/ui/sonner'
import { AuthScreen } from '@/screens/AuthScreen'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { Builder } from '@/screens/Builder'
import type { Project } from '@/lib/api'

// shadcn's dark tokens key off a `.dark` class, so follow the OS setting rather than
// shipping a toggle — one less control, and it matches whatever the user already chose.
function useSystemTheme() {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => document.documentElement.classList.toggle('dark', mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
}

export default function App() {
  useSystemTheme()
  const { data: session, isPending } = authClient.useSession()
  const [active, setActive] = useState<{ project: Project; firstPrompt?: string } | null>(null)

  return (
    // reducedMotion="user" honours the OS setting — animation is a nicety, never a cost
    // imposed on someone who asked for less of it.
    <MotionConfig reducedMotion="user">
      {isPending ? (
        <div className="grid min-h-dvh place-items-center bg-background" />
      ) : !session ? (
        <AuthScreen />
      ) : !active ? (
        <ProjectsScreen onOpen={(project, firstPrompt) => setActive({ project, firstPrompt })} />
      ) : (
        <Builder {...active} onBack={() => setActive(null)} />
      )}
      <Toaster />
    </MotionConfig>
  )
}
