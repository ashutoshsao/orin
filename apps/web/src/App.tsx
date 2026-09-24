import { lazy, Suspense, useEffect, useState } from 'react'
import { MotionConfig } from 'motion/react'
import { authClient } from './authClient'
import { Toaster } from '@/components/ui/sonner'
import { AuthScreen } from '@/screens/AuthScreen'
import { ProjectsScreen } from '@/screens/ProjectsScreen'
import { AccessEndedScreen } from '@/screens/AccessEndedScreen'
import { InviteScreen } from '@/screens/InviteScreen'
import { GuestScreen } from '@/screens/GuestScreen'
import { useAccess } from '@/lib/access'
import type { Project } from '@/lib/api'

// Split by audience: a visitor on the landing page never downloads the builder, and a signed-in
// user never downloads the landing page.
const Landing = lazy(() => import('@/screens/landing/Landing').then((m) => ({ default: m.Landing })))
const Builder = lazy(() => import('@/screens/Builder').then((m) => ({ default: m.Builder })))
const AdminScreen = lazy(() => import('@/screens/AdminScreen').then((m) => ({ default: m.AdminScreen })))
const blank = <div className="grid min-h-dvh place-items-center bg-background" />

export default function App() {
  const { data: session, isPending } = authClient.useSession()
  const [active, setActive] = useState<{ project: Project; firstPrompt?: string } | null>(null)
  const { access, byok, refresh: refreshAccess } = useAccess(!!session)
  // The only URLs the app reads: /invite/<token> (7b) and /g/<token> (7c). Everything else
  // is one screen stack.
  const path = window.location.pathname
  const inviteToken = path.startsWith('/invite/') ? path.slice('/invite/'.length) : null
  const guestToken = path.startsWith('/g/') ? path.slice('/g/'.length) : null
  const isAdminPath = path === '/admin'
  // Signed out: `/` is the landing page and `/sign-in` the auth screen. Kept in state (not just read
  // once) so the landing page's buttons and the browser's back button move between the two.
  const [signingIn, setSigningIn] = useState(() => path === '/sign-in')
  useEffect(() => {
    const onPop = () => setSigningIn(window.location.pathname === '/sign-in')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const goSignIn = () => { window.history.pushState(null, '', '/sign-in'); setSigningIn(true); window.scrollTo(0, 0) }

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
        signingIn ? <AuthScreen /> : <Suspense fallback={blank}><Landing onStart={goSignIn} /></Suspense>
      ) : isAdminPath ? (
        <Suspense fallback={blank}><AdminScreen /></Suspense>
      ) : !access || access.expired ? (
        <AccessEndedScreen expired={!!access?.expired} />
      ) : !active ? (
        <ProjectsScreen access={access} byok={byok} onAccessChange={refreshAccess} onOpen={(project, firstPrompt) => setActive({ project, firstPrompt })} />
      ) : (
        <Suspense fallback={blank}>
          <Builder {...active} access={access} onAccessChange={refreshAccess} onBack={() => { setActive(null); refreshAccess() }} />
        </Suspense>
      )}
      <Toaster />
    </MotionConfig>
  )
}
