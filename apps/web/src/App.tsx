import { useState } from 'react'
import { MotionConfig } from 'motion/react'
import { authClient } from './authClient'
import { Toaster } from '@/components/ui/sonner'
import { AuthScreen } from '@/screens/AuthScreen'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { Builder } from '@/screens/Builder'
import { AccessEndedScreen } from '@/screens/AccessEndedScreen'
import { useAccess } from '@/lib/access'
import type { Project } from '@/lib/api'

export default function App() {
  const { data: session, isPending } = authClient.useSession()
  const [active, setActive] = useState<{ project: Project; firstPrompt?: string } | null>(null)
  const { access, refresh: refreshAccess } = useAccess(!!session)

  return (
    // reducedMotion="user" honours the OS setting — animation is a nicety, never a cost
    // imposed on someone who asked for less of it.
    <MotionConfig reducedMotion="user">
      {isPending || (session && access === undefined) ? (
        <div className="grid min-h-dvh place-items-center bg-background" />
      ) : !session ? (
        <AuthScreen />
      ) : !access || access.expired ? (
        <AccessEndedScreen expired={!!access?.expired} />
      ) : !active ? (
        <ProjectsScreen access={access} onOpen={(project, firstPrompt) => setActive({ project, firstPrompt })} />
      ) : (
        <Builder {...active} access={access} onAccessChange={refreshAccess} onBack={() => { setActive(null); refreshAccess() }} />
      )}
      <Toaster />
    </MotionConfig>
  )
}
