import { useEffect, useState } from 'react'

// The builder can't do this with CSS alone. Below `md` the chat moves *inside* a drawer, which is
// a different place in the tree — and rendering it twice (one hidden per breakpoint) would mean
// two copies of the feed, two scroll anchors, and a ref that lands on whichever rendered last.
// So the layout switches in JS and the chat exists exactly once.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange() // the query may have changed between render and effect (e.g. a rotation)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
