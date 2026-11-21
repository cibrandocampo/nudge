import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import buttons from '../styles/buttons.module.css'
import cx from '../utils/cx'
import Icon from './Icon'
import s from './OverflowMenu.module.css'

/**
 * «More» menu for the rare actions of a detail screen (T152, UX-018/034):
 * history, deactivate, delete. The frequent ones stay on screen as text
 * buttons.
 *
 * WAI-ARIA APG «menu button»: the trigger opens a `role="menu"` of
 * `role="menuitem"` entries with a roving focus.
 *   - Enter / Space / ↓ on the trigger open it on the first item, ↑ on the last.
 *   - ↓ / ↑ move with wrap-around, Home / End jump to the ends.
 *   - Esc closes and returns focus to the trigger; Tab closes and lets focus
 *     move on from the trigger.
 *   - Choosing an item, a pointer outside the menu or a route change close it.
 *
 * Props:
 *   items — `{ key, label, icon?, onSelect?, to?, danger?, disabled?,
 *            onDisabledSelect?, testId? }[]`. `to` renders a link; a
 *            `disabled` item stays focusable (`aria-disabled`) and calls
 *            `onDisabledSelect` instead (the offline toast), as the buttons it
 *            replaces did.
 *   testId — `data-testid` of the trigger (`<testId>-items` on the menu).
 */
export default function OverflowMenu({ items, testId = 'more-menu' }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [focusIndex, setFocusIndex] = useState(0)
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const itemRefs = useRef([])
  const menuId = useId()
  const { pathname } = useLocation()

  // A route change (an item that is a link, the back button) closes it.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (open) itemRefs.current[focusIndex]?.focus()
  }, [open, focusIndex])

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const openAt = (index) => {
    setFocusIndex(index)
    setOpen(true)
  }

  const close = ({ returnFocus }) => {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  const onTriggerKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAt(0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAt(items.length - 1)
    }
  }

  const onMenuKeyDown = (event) => {
    const last = items.length - 1
    const moves = {
      ArrowDown: focusIndex === last ? 0 : focusIndex + 1,
      ArrowUp: focusIndex === 0 ? last : focusIndex - 1,
      Home: 0,
      End: last,
    }
    if (event.key in moves) {
      event.preventDefault()
      setFocusIndex(moves[event.key])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close({ returnFocus: true })
    } else if (event.key === 'Tab') {
      // Hand the focus to the trigger before the menu unmounts, without
      // cancelling the Tab: the browser then moves on from the trigger (to
      // the next control, or the previous one with Shift). Left on the item,
      // the focus would vanish with it and land wherever the browser chose.
      close({ returnFocus: true })
    } else if (event.key === ' ' && event.target.tagName === 'A') {
      // Space activates a menu item; a button does it natively, a link not.
      event.preventDefault()
      event.target.click()
    }
  }

  const choose = (item) => {
    if (item.disabled) {
      item.onDisabledSelect?.()
      return
    }
    close({ returnFocus: !item.to })
    item.onSelect?.()
  }

  return (
    <div className={s.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={cx(buttons.icon, buttons.outlined)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t('menu.more')}
        title={t('menu.more')}
        onClick={() => (open ? setOpen(false) : openAt(0))}
        onKeyDown={onTriggerKeyDown}
        data-testid={testId}
      >
        <Icon name="more-vertical" />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          aria-label={t('menu.more')}
          className={s.menu}
          onKeyDown={onMenuKeyDown}
          data-testid={`${testId}-items`}
        >
          {items.map((item, index) => {
            const props = {
              ref: (el) => (itemRefs.current[index] = el),
              role: 'menuitem',
              tabIndex: -1,
              className: cx(s.item, item.danger && s.danger, item.disabled && buttons.disabledText),
              'aria-disabled': item.disabled || undefined,
              'data-testid': item.testId,
              onClick: (event) => {
                if (item.to && item.disabled) event.preventDefault()
                choose(item)
              },
            }
            const content = (
              <>
                {item.icon && <Icon name={item.icon} />}
                <span>{item.label}</span>
              </>
            )
            return (
              <li key={item.key} role="none">
                {item.to ? (
                  <Link to={item.to} {...props}>
                    {content}
                  </Link>
                ) : (
                  <button type="button" {...props}>
                    {content}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
