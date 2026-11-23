import { useContext, useEffect, useRef } from 'react'
import { UNSAFE_NavigationContext, useLocation, useNavigate } from 'react-router-dom'

/**
 * The ordered list of open overlays (modals, sheets, menus). Only the top one
 * answers Escape and Android «back».
 *
 * Opening an overlay adds one history entry at the same URL, whose router state
 * lists the overlays open on it. An overlay then ends in one of three ways:
 *   - «back»: the entry is already gone, so it only closes;
 *   - closed in place (✕, Cancel, scrim, Escape): it removes its own entry;
 *   - closed by navigating away: the entry stays behind, buried under the new
 *     page, and `OverlayHistory` skips it when «back» lands on it.
 */
const STATE_KEY = 'overlays'

let stack = []
let nextId = 1
// `history.go` is asynchronous in a browser. A menu item that closes the menu and
// opens a modal would otherwise push on top of the entry being removed, and the
// late «back» would then land on the modal and close it.
let popInFlight = false
let queuedPushes = []

export const overlayChain = (location) => location?.state?.[STATE_KEY] ?? []

/** An entry left by an overlay that is no longer open. */
export const isDeadOverlayEntry = (location) =>
  overlayChain(location).some((id) => !stack.some((overlay) => overlay.id === id))

function onKeyDown(event) {
  if (event.key === 'Escape') stack.at(-1)?.close(event)
}

function addToStack(overlay) {
  if (stack.length === 0) document.addEventListener('keydown', onKeyDown)
  stack.push(overlay)
}

function removeFromStack(overlay) {
  stack = stack.filter((other) => other !== overlay)
  if (stack.length === 0) document.removeEventListener('keydown', onKeyDown)
}

function popEntry(history) {
  const before = history.location.key
  history.go(-1)
  if (history.location.key !== before) return
  popInFlight = true
  window.addEventListener(
    'popstate',
    () => {
      popInFlight = false
      const pushes = queuedPushes
      queuedPushes = []
      pushes.forEach((push) => push())
    },
    { once: true },
  )
}

function pushEntry(history, navigate, overlay) {
  if (popInFlight) {
    queuedPushes.push(() => pushEntry(history, navigate, overlay))
    return
  }
  if (!stack.includes(overlay)) return
  const { pathname, search, hash, state } = history.location
  navigate(
    { pathname, search, hash },
    { state: { ...state, [STATE_KEY]: [...overlayChain(history.location), overlay.id] } },
  )
  overlay.inHistory = true
}

// Read from the history itself, not from the router's state: a «back» pressed
// right after opening can land before the router has rendered the new entry.
function closeIfLeft(history, overlay) {
  if (!overlay.inHistory || history.action !== 'POP') return
  if (overlayChain(history.location).includes(overlay.id)) return
  overlay.inHistory = false
  overlay.leftByBack = true
  overlay.close()
}

/** Empties the stack. The list outlives a test's render, so tests reset it. */
export function resetOverlays() {
  stack = []
  popInFlight = false
  queuedPushes = []
  document.removeEventListener('keydown', onKeyDown)
}

export function useOverlay({ open = true, onClose }) {
  const navigate = useNavigate()
  const location = useLocation()
  // The router's history: unlike `useLocation`, it is already up to date when
  // a click both closes an overlay and navigates.
  const { navigator: history } = useContext(UNSAFE_NavigationContext)
  const overlayRef = useRef(null)
  const onCloseRef = useRef(onClose)
  // `navigate` changes with the route; an open overlay must not re-register.
  const navigateRef = useRef(navigate)

  useEffect(() => {
    onCloseRef.current = onClose
    navigateRef.current = navigate
  })

  useEffect(() => {
    if (!open) return undefined

    let overlay = overlayRef.current
    if (!overlay) {
      overlay = {
        id: nextId++,
        close: (event) => onCloseRef.current?.(event),
        inHistory: false,
        leftByBack: false,
        active: true,
        settled: false,
      }
      overlayRef.current = overlay
      addToStack(overlay)
      pushEntry(history, (...args) => navigateRef.current(...args), overlay)
    }
    overlay.active = true
    overlay.settled = false
    queueMicrotask(() => {
      overlay.settled = true
    })

    const release = () => {
      if (overlayRef.current !== overlay) return
      overlayRef.current = null
      removeFromStack(overlay)
      if (!overlay.leftByBack && overlayChain(history.location).at(-1) === overlay.id) popEntry(history)
    }

    const onPopState = () => closeIfLeft(history, overlay)
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('popstate', onPopState)
      overlay.active = false
      if (overlay.settled) {
        release()
        return
      }
      // StrictMode runs cleanup and setup again right after mounting, which
      // must not count as closing: only release it if setup did not come back.
      queueMicrotask(() => {
        if (!overlay.active) release()
      })
    }
  }, [open, history])

  useEffect(() => {
    if (overlayRef.current) closeIfLeft(history, overlayRef.current)
  }, [location, history])
}
