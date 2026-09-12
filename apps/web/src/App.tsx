import { useState } from 'react'
import { MotionConfig } from 'motion/react'
import { authClient } from './authClient'
import { Toaster } from '@/components/ui/sonner'
import { AuthScreen } from '@/screens/AuthScreen'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { Builder } from '@/screens/Builder'
import { AccessEndedScreen } from '@/screens/AccessEndedScreen'
import { InviteScreen } from '@/screens/InviteScreen'
import { GuestScreen } from '@/screens/GuestScreen'
import { AdminScreen } from '@/screens/AdminScreen'
import { useAccess } from '@/lib/access'
import type { Project } from '@/lib/api'

export default function App() {
  const { data: session, isPending } = authClient.useSession()
  const [active, setActive] = useState<{ project: Project; firstPrompt?: string } | null>(null)
  const { access, refresh: refreshAccess } = useAccess(!!session)
  // The only URLs the app reads: /invite/<token> (7b) and /g/<token> (7c). Everything else
  // is one screen stack.
  const path = window.location.pathname
  const inviteToken = path.startsWith('/invite/') ? path.slice('/invite/'.length) : null
  const guestToken = path.startsWith('/g/') ? path.slice('/g/'.length) : null
  const isAdminPath = path === '/admin'

  return (
    // reducedMotion="user" honours the OS setting — animation is a nicety, never a cost
    // imposed on someone who asked for less of it.
    <MotionConfig reducedMotion="user">
      {guestToken ? (
        <GuestScreen token={guestToken} />
      ) : inviteToken ? (
        <InviteScreen token={inviteToken} />
      ) : isPending || (session && access === undefined) ? (
        <div className="grid min-h-dvh place-items-center bg-background" />
      ) : !session ? (
        <AuthScreen />
      ) : isAdminPath ? (
        <AdminScreen />
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
