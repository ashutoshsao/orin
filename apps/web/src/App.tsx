import { useState } from 'react'
import { MotionConfig } from 'motion/react'
import { authClient } from './authClient'
import { Toaster } from '@/components/ui/sonner'
import { AuthScreen } from '@/screens/AuthScreen'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { Builder } from '@/screens/Builder'
import type { Project } from '@/lib/api'

export default function App() {
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
