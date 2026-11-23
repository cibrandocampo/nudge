import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOverlay } from '../hooks/useOverlay'
import buttons from '../styles/buttons.module.css'
import layout from '../styles/layout.module.css'
import cx from '../utils/cx'
import Icon from './Icon'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Hands the focus back once the modal is gone. Leaves it alone if something
 * else took it on purpose, and falls back to the page heading when the control
 * that opened the modal no longer exists (a deleted row).
 */
function restoreFocus(trigger) {
  const active = document.activeElement
  if (active && active !== document.body) return
  if (!trigger || trigger === document.body) return
  if (trigger.isConnected) {
    trigger.focus({ preventScroll: true })
    return
  }
  const heading = document.querySelector('h1')
  if (!heading) return
  heading.setAttribute('tabindex', '-1')
  heading.focus({ preventScroll: true })
  heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), { once: true })
}

/**
 * The frame of every modal: scrim, box, close button, focus, Escape and
 * Android «back» (through `useOverlay`).
 *
 * Props:
 *   title, subtitle — the heading, which also names the dialog.
 *   labelledBy — id of a heading drawn by the children (`variant="framed"`).
 *   showClose — false only where a visible «Cancel» is already the way out.
 *   variant — `box` (centred), `framed` (children draw header and footer) or
 *             `sheet` (anchored to the bottom).
 *   testId — `data-testid` of the box (`<testId>-overlay` on the scrim).
 *   dirty — it holds typed content: a tap on the scrim no longer closes it.
 *           Back, ✕ and Escape still do.
 */
export default function ModalFrame({
  onClose,
  title,
  subtitle,
  labelledBy,
  size = 'sm',
  variant = 'box',
  closeAriaLabel,
  showClose = true,
  dirty = false,
  testId,
  children,
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const boxRef = useRef(null)
  const pressedInside = useRef(false)
  // Read while rendering: by the first effect, an `autoFocus` child has it.
  const [trigger] = useState(() => document.activeElement)
  useOverlay({ onClose })

  useEffect(() => {
    const box = boxRef.current
    if (!box.contains(document.activeElement)) box.focus({ preventScroll: true })
    return () => {
      // StrictMode's simulated unmount leaves the box in the document.
      if (!box.isConnected) restoreFocus(trigger)
    }
  }, [trigger])

  const onKeyDown = (event) => {
    if (event.key !== 'Tab') return
    const box = boxRef.current
    // A modal opened from inside this one handles its own Tab.
    if (event.target.closest('[role="dialog"]') !== box) return
    const focusable = [...box.querySelectorAll(FOCUSABLE)]
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === box)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const onScrimPointerDown = (event) => {
    pressedInside.current = event.target !== event.currentTarget
  }

  const onScrimClick = (event) => {
    // A drag that began in the box (selecting text) also ends in a click here.
    const startedInside = pressedInside.current
    pressedInside.current = false
    if (event.target === event.currentTarget && !startedInside && !dirty) onClose(event)
  }

  const stopPropagation = (e) => e.stopPropagation()
  const namedBy = labelledBy ?? (title ? titleId : undefined)
  const framed = variant === 'framed'
  const sheet = variant === 'sheet'

  return (
    <div
      className={cx(layout.overlay, sheet && layout.overlaySheet)}
      onPointerDown={onScrimPointerDown}
      onClick={onScrimClick}
      data-testid={testId ? `${testId}-overlay` : undefined}
    >
      <div
        ref={boxRef}
        className={cx(
          framed ? layout.modalBoxFramed : sheet ? layout.modalSheet : layout.modalBox,
          size === 'md' && layout.modalBoxMd,
          size === 'lg' && layout.modalBoxLg,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={namedBy}
        aria-label={namedBy ? undefined : (closeAriaLabel ?? t('common.close'))}
        tabIndex={-1}
        onClick={stopPropagation}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        {!framed && title && (
          <h2
            id={titleId}
            className={cx(
              layout.modalTitle,
              showClose && layout.modalTitleWithClose,
              subtitle && layout.modalTitleTight,
            )}
          >
            {title}
          </h2>
        )}
        {!framed && subtitle && <p className={layout.modalSubtitle}>{subtitle}</p>}
        {showClose && (
          <button
            type="button"
            className={cx(buttons.icon, layout.modalClose)}
            onClick={onClose}
            aria-label={t('common.close')}
            data-testid="modal-close"
          >
            <Icon name="x" size="sm" />
          </button>
        )}
        {children}
      </div>
    </div>
  )
}
