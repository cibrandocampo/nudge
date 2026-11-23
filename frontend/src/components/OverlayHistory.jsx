import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { isDeadOverlayEntry, overlayChain } from '../hooks/useOverlay'

/**
 * Headless. Keeps entries left by closed overlays out of the user's way: «back»
 * or «forward» landing on one carries on in the same direction, and a reload on
 * top of one returns to the page underneath. See `useOverlay`.
 */
export default function OverlayHistory() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  // Relative order of the entries seen in this session, to tell back from
  // forward: a pop event does not say which way it went.
  const trail = useRef({ positions: new Map(), current: 0, last: 0, key: null })

  useEffect(() => {
    const seen = trail.current
    if (seen.key === location.key) return

    if (seen.key === null) {
      seen.key = location.key
      seen.positions.set(location.key, 0)
      const leftover = overlayChain(location).length
      if (leftover > 0) navigate(-leftover)
      return
    }
    seen.key = location.key

    if (navigationType === 'PUSH') {
      seen.current += 1
      seen.last = seen.current
      seen.positions.set(location.key, seen.current)
      return
    }
    if (navigationType === 'REPLACE') {
      seen.positions.set(location.key, seen.current)
      return
    }

    // An entry from before a reload is unknown: it can only be further back.
    const position = seen.positions.get(location.key) ?? seen.current - 1
    const wentBack = position < seen.current
    seen.current = position
    seen.positions.set(location.key, position)
    if (!isDeadOverlayEntry(location)) return
    navigate(wentBack || position >= seen.last ? -1 : 1)
  }, [location, navigationType, navigate])

  return null
}
