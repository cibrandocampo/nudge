import { useEffect } from 'react'

export function useEscapeKey(callback, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e) => {
      if (e.key === 'Escape') callback(e)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [callback, enabled])
}
