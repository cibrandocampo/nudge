import { useEffect } from 'react'

export function useClickOutside(ref, callback, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) callback(e)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, callback, enabled])
}
