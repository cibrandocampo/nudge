import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { formatRelativeTime, formatAbsoluteDate } from '../utils/time'
import cx from '../utils/cx'
import { findCachedStock } from '../utils/lotsForSelection'
import { iconClassForStock } from '../utils/stockSeverity'
import { useSwipeAction } from '../hooks/useSwipeAction'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import s from './RoutineCard.module.css'

// Exit sequence (T101): the card slides off to the right, then the row
// collapses its height, then the completion fires. Logging first would let the
// optimistic update yank the card out of the list mid-animation. Timers rather
// than `transitionend`: a completion must never hang on an event the browser
// may skip (hidden tab, interrupted transition). The CSS reads the same values.
export const EXIT_MS = 180
export const COLLAPSE_MS = 140
// The "no" shake of a blocked check button.
const NUDGE_MS = 300

// Time only (T106): green not due, amber due today, red overdue. Stock never
// recolours the dot or the time — a routine due in 10 days with an empty stock
// is not urgent; its stock line carries that problem instead.
function statusTokens(routine) {
  if (!routine.is_due) return { dot: cards.dotSuccess, text: cards.statusOk }
  if (routine.is_overdue) return { dot: cards.dotDanger, text: cards.statusOverdue }
  return { dot: cards.dotWarning, text: cards.statusDue }
}

/**
 * A routine on the dashboard (T101). Two stacked layers in one row:
 *
 * - The **action layer** behind: green (red and hatched when the stock can't
 *   cover a completion) with the check button at its left edge.
 * - The **card** in front, a link to the routine detail, resting shifted to
 *   the right so the layer peeks out: a thin strip on touch, the strip plus a
 *   clickable check with a mouse (the CSS decides by pointer type).
 *
 * Swiping the card right past the threshold, or clicking the check, plays the
 * exit and then calls `onMarkDone(id, { revert })`. `revert` brings the card
 * back to rest when the caller does not log after all (lot picker, error).
 *
 * Each colour has one meaning (T106): the dot and the time text say *when*;
 * the stock line says whether the stock covers a completion (grey icon when
 * it does, amber when low, red line with the reason when it doesn't); the
 * action layer says what a swipe would do, and on touch it stays grey at rest,
 * taking its colour only while dragged. Every routine gets the layer, due or
 * upcoming (T102); a `highlighted` row flashes briefly to show where a
 * completed one moved.
 */
export default function RoutineCard({ routine, onMarkDone, completing, highlighted = false }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // rest → leaving (card slides out) → collapsing (row closes) → onMarkDone.
  const [phase, setPhase] = useState('rest')
  const [nudging, setNudging] = useState(false)
  const timersRef = useRef([])
  // A commit whose `onMarkDone` hasn't fired yet. If the card unmounts mid
  // exit (the user navigates away), the completion still goes through.
  const pendingRef = useRef(null)
  // A routine completed from Upcoming stays mounted in the same list. When its
  // dates change (optimistic re-date, rollback, refetch) the collapsed card
  // comes back at rest in its new place. Adjusted during render, the React
  // pattern for state derived from a changing prop.
  const datesKey = `${routine.next_due_at}|${routine.last_entry_at}`
  const [seenDates, setSeenDates] = useState(datesKey)
  if (seenDates !== datesKey) {
    setSeenDates(datesKey)
    setPhase('rest')
  }

  const timeLabel = routine.next_due_at
    ? formatRelativeTime(routine.next_due_at)
    : `${t('card.since')} ${formatAbsoluteDate(routine.created_at)}`

  const resourceKey = `routine:${routine.id}`
  const cachedStock = findCachedStock(queryClient, routine.stock)
  const iconCls = iconClassForStock(cachedStock)

  // Passive badge only — sharing is edited from the routine form
  // (ShareWithSection → ShareModal). Mirrors the pattern used on StockRow.
  // Owner sees the filled variant; recipient sees the outlined one. Both
  // use the same icon so the visual language is consistent.
  const isShared = routine.shared_with?.length > 0 || routine.is_owner === false
  const isOwnerOfShare = routine.is_owner !== false
  const sharedBadgeAria = isOwnerOfShare
    ? t('sharing.sharedBadgeOwnerAria')
    : t('sharing.sharedBadgeRecipientAria', { owner: routine.owner_display_name })
  const sharedBadge = isShared && (
    <span
      className={cx(buttons.btnIcon, isOwnerOfShare ? buttons.btnIconShared : buttons.btnIconSharedRecipient)}
      aria-label={sharedBadgeAria}
      title={sharedBadgeAria}
      data-testid="shared-badge"
      data-variant={isOwnerOfShare ? 'owner' : 'recipient'}
    >
      <Icon name="users" size="sm" />
    </span>
  )

  // Block completion when the routine consumes a stock with no inventory
  // — pain_relief (ibuprofen 0u) is the canonical seed case. The layer turns
  // red and the check stays reachable (aria-disabled, not disabled) so its
  // tooltip explains why and a click answers with a shake.
  // T165: read `stock_quantity_available` (excludes expired lots) so a routine
  // backed by a stock with only expired lots is correctly blocked. Falls back
  // to `stock_quantity` for cached snapshots from the pre-T163 API contract;
  // the fallback becomes dead code once caches refresh.
  const stockAvailable = routine.stock_quantity_available ?? routine.stock_quantity ?? 0
  const stockDepleted = Boolean(routine.stock_name) && Number(stockAvailable) < Number(routine.stock_usage)
  const tokens = statusTokens(routine)
  const idle = phase === 'rest' && !completing

  const commit = () => {
    pendingRef.current = () => onMarkDone(routine.id, { revert })
    // The leaving card is positioned by CSS from here on; dropping the drag
    // offset now means a card that comes back (revert, re-dated) is at rest.
    swipe.reset()
    if (swipe.reducedMotion) {
      // No exit to watch: hide the row and log straight away.
      setPhase('collapsing')
      fire()
      return
    }
    setPhase('leaving')
    timersRef.current.push(
      setTimeout(() => {
        setPhase('collapsing')
        timersRef.current.push(setTimeout(fire, COLLAPSE_MS))
      }, EXIT_MS),
    )
  }

  const swipe = useSwipeAction({ enabled: idle, blocked: stockDepleted, onCommit: commit })

  function fire() {
    const pending = pendingRef.current
    pendingRef.current = null
    pending?.()
  }

  function clearTimers() {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  function revert() {
    clearTimers()
    pendingRef.current = null
    setPhase('rest')
    swipe.reset()
  }

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout)
      const pending = pendingRef.current
      pendingRef.current = null
      pending?.()
    },
    [],
  )

  // A short buzz when crossing the threshold, where supported (Android).
  // Only on arming: disarming stays silent.
  const wasArmedRef = useRef(false)
  useEffect(() => {
    if (swipe.armed && !wasArmedRef.current) navigator.vibrate?.(10)
    wasArmedRef.current = swipe.armed
  }, [swipe.armed])

  const onCheckClick = () => {
    if (!idle) return
    if (stockDepleted) {
      setNudging(true)
      timersRef.current.push(setTimeout(() => setNudging(false), NUDGE_MS))
      return
    }
    commit()
  }

  const chevronButton = (
    <span className={cx(buttons.btnIcon, buttons.btnIconAction)} aria-hidden="true">
      <Icon name="chevron-right" size="sm" />
    </span>
  )

  const body = (
    <div className={cards.cardHeader}>
      <div className={cards.cardMeta}>
        <span className={cx(cards.cardTitle, cards.cardTitleFlex)}>
          <span>{routine.name}</span>
          <SyncStatusBadge resourceKey={resourceKey} className={s.syncBadge} />
        </span>
        <span className={cards.cardSubtitle}>
          <span className={cx(cards.status, tokens.text)}>
            <span className={cx(cards.dot, tokens.dot)} />
            {timeLabel}
          </span>
        </span>
        {routine.stock_name &&
          (stockDepleted ? (
            <span className={cx(cards.cardStockBadge, cards.stockDepletionDanger)} data-testid="stock-line">
              <Icon name="package" size="sm" className={cards.iconDanger} data-testid="stock-icon" />
              {t('card.stockDepletedLine', { stock: routine.stock_name })}
            </span>
          ) : (
            <span className={cards.cardStockBadge} data-testid="stock-line">
              <Icon name="package" size="sm" className={iconCls} data-testid="stock-icon" />
              {routine.stock_usage} × {routine.stock_name}
            </span>
          ))}
      </div>
      <div className={cards.cardActions}>
        {sharedBadge}
        {chevronButton}
      </div>
    </div>
  )

  const link = (
    <Link
      to={`/routines/${routine.id}`}
      className={cx(cards.card, cards.cardClickable, s.card, nudging && s.nudging)}
      draggable={false}
      data-testid="routine-card-link"
      {...swipe.handlers}
    >
      {body}
    </Link>
  )

  let layerState = 'idle'
  if (stockDepleted) layerState = 'blocked'
  else if (swipe.armed || phase !== 'rest') layerState = 'armed'

  return (
    <div
      className={cx(s.row, highlighted && s.highlighted)}
      data-testid="routine-card"
      data-phase={phase}
      data-highlighted={highlighted ? 'true' : undefined}
      data-dragging={swipe.dragging}
      style={{
        '--drag': `${swipe.offset}px`,
        '--progress': swipe.progress,
        '--exit-ms': `${EXIT_MS}ms`,
        '--collapse-ms': `${COLLAPSE_MS}ms`,
        '--nudge-ms': `${NUDGE_MS}ms`,
      }}
    >
      <div className={s.clip}>
        <div className={s.actionLayer} data-state={layerState} data-testid="routine-action-layer">
          <button
            type="button"
            className={s.check}
            onClick={onCheckClick}
            aria-label={t('card.markDone')}
            aria-disabled={!idle || stockDepleted ? 'true' : undefined}
            title={stockDepleted ? t('card.noStockAvailable') : undefined}
          >
            {stockDepleted ? (
              <Icon name="x" />
            ) : (
              <svg className={cx('icon', s.checkIcon)} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <polyline points="20 6 9 17 4 12" pathLength="1" />
              </svg>
            )}
          </button>
          <span className={s.actionLabel} aria-hidden="true">
            {stockDepleted ? t('card.noStockAvailable') : t('card.swipeDone')}
          </span>
        </div>
        {link}
      </div>
    </div>
  )
}
