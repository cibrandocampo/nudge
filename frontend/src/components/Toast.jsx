import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle, Info, X, XCircle } from 'lucide-react'
import { ToastContext } from './ToastContext'
import s from './Toast.module.css'

const DEFAULT_DURATION = 4000

const ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
}

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  // Keep a ref of active timers so `dismissToast` can cancel them and we can
  // clean everything up on unmount.
  const timers = useRef(new Map())

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const handle = timers.current.get(id)
    if (handle) {
      clearTimeout(handle)
      timers.current.delete(id)
    }
  }, [])

  const showToast = useCallback(
    ({ type = 'info', message, duration = DEFAULT_DURATION, action = null }) => {
      idCounter += 1
      const id = idCounter
      setToasts((prev) => [...prev, { id, type, message, action }])
      // `duration: 0` means "keep it open until the user acts" — used by the
      // sync-errors toast (T065) so it can't scroll off-screen before the
      // user notices.
      if (duration > 0) {
        const handle = setTimeout(() => dismissToast(id), duration)
        timers.current.set(id, handle)
      }
      return id
    },
    [dismissToast],
  )

  useEffect(() => {
    const active = timers.current
    return () => {
      active.forEach((handle) => clearTimeout(handle))
      active.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div className={s.stack} role="region" aria-label="Notifications">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type] ?? Info
          return (
            <div
              key={toast.id}
              className={`${s.toast} ${s[toast.type] ?? ''}`}
              role={toast.type === 'error' ? 'alert' : 'status'}
              data-testid={`toast-${toast.type}`}
            >
              <Icon className={s.icon} size={18} aria-hidden="true" />
              <span className={s.message}>{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className={s.action}
                  onClick={() => {
                    toast.action.onClick?.()
                    dismissToast(toast.id)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                className={s.close}
                onClick={() => dismissToast(toast.id)}
                aria-label="Dismiss notification"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
