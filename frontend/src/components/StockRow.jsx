import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSwipeAction } from '../hooks/useSwipeAction'
import { toMonthly } from '../utils/consumption'
import cx from '../utils/cx'
import { stockRowReasons, stockStatus } from '../utils/stockAlerts'
import { borderTokensFromStock } from '../utils/stockSeverity'
import { formatShortDate, getLocale } from '../utils/time'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import s from './StockRow.module.css'

// How far a row travels: enough to mean it, and it comes back.
export const SWIPE_STOP_RATIO = 1 / 3

const STATUS_LABEL = {
  danger: 'inventory.statusDanger',
  warning: 'inventory.statusWarning',
  ok: 'inventory.statusOk',
}

/**
 * A product as one compact row of the inventory: what it is and how much is
 * left on line 1, why it matters and until when on line 2, in columns that
 * line up down the list. Line 2 only exists when there is something to say.
 *
 * The row is one link to the product (T205), in front of a consume layer
 * (T130). Swiping it right up to a third of its width consumes one unit; it
 * then springs back, since the product stays in the list. A flick short of the
 * stop does nothing: this takes a unit of someone's medication.
 *
 * The layer holds a real «Consume 1 unit» button, never nested in the link. A
 * mouse sees it at rest, the keyboard uncovers it on focus, and on touch it
 * stays behind the row. E2E opens a product by the link's `row-open-detail`
 * test id and consumes by that button's name (`focus()` + Enter on touch).
 */
export default function StockRow({ stock, consuming, flashing, onConsume }) {
  const { t } = useTranslation()
  const tokens = borderTokensFromStock(stock)

  const quantity = stock.quantity_available ?? stock.quantity ?? 0

  // Passive indicator after the name (T107): the routine card's markup — a
  // bare `users` icon with role="img", the same for owner and recipient. It is
  // part of the row, so tapping it opens the detail like the rest of the row.
  const isShared = stock.shared_with?.length > 0 || stock.is_owner === false
  const isOwnerOfShare = stock.is_owner !== false
  const sharedBadgeAria = isOwnerOfShare
    ? t('sharing.sharedBadgeOwnerAria')
    : t('sharing.sharedBadgeRecipientAria', { owner: stock.owner_display_name ?? '' })

  const ownRate = stock.daily_consumption_own || 0
  const sharedRate = stock.daily_consumption_shared || 0
  const totalRate = ownRate + sharedRate

  // Why this product needs attention, said on its own row (the inventory has
  // no summary banner: the Atención chip filters, the row explains). See
  // `stockRowReasons` for what is said and what is left to the quantity and
  // the depletion date.
  const reasons = stockRowReasons(stock)
  const outOfStock = quantity === 0

  const rate = (daily) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: 1 }).format(toMonthly(daily))
  const hasMeta = totalRate > 0 || reasons.length > 0

  const swipe = useSwipeAction({
    enabled: !consuming,
    blocked: outOfStock,
    maxRatio: SWIPE_STOP_RATIO,
    allowFlick: false,
    onCommit: () => {
      swipe.reset()
      onConsume(stock)
    },
  })

  // A short buzz on reaching the stop, where supported (Android).
  const wasArmedRef = useRef(false)
  useEffect(() => {
    if (swipe.armed && !wasArmedRef.current && !swipe.reducedMotion) navigator.vibrate?.(10)
    wasArmedRef.current = swipe.armed
  }, [swipe.armed, swipe.reducedMotion])

  let layerState = 'idle'
  if (outOfStock) layerState = 'blocked'
  else if (swipe.armed) layerState = 'armed'

  return (
    <div className={s.row} data-testid="product-card" data-dragging={swipe.dragging}>
      <div className={s.actionLayer} data-state={layerState} data-testid="row-action-layer">
        <button
          type="button"
          className={cx(buttons.hit, s.consume)}
          onClick={() => onConsume(stock)}
          disabled={outOfStock || consuming}
          aria-label={outOfStock ? t('inventory.consumeEmpty') : t('inventory.consumeTooltip')}
          title={outOfStock ? t('inventory.consumeEmpty') : t('inventory.consumeTooltip')}
          data-testid="row-consume"
        >
          <Icon name="package" className={buttons.consumeBox} />
          <Icon name="arrow-down" className={buttons.consumeArrow} />
        </button>
        <span className={s.minusOne} aria-hidden="true">
          −1
        </span>
      </div>

      <Link
        to={`/inventory/${stock.id}`}
        className={s.link}
        style={{ '--drag': `${swipe.offset}px` }}
        draggable={false}
        data-testid="row-open-detail"
        {...swipe.handlers}
      >
        <span className={s.main}>
          <span
            className={cx(cards.dot, tokens.dot)}
            role="img"
            aria-label={t(STATUS_LABEL[stockStatus(stock)])}
            data-testid="row-status"
          />
          <span className={s.nameGroup}>
            <span className={cx(s.name, cards.clampName)}>{stock.name}</span>
            {isShared && (
              <span
                className={cards.sharedIcon}
                role="img"
                aria-label={sharedBadgeAria}
                title={sharedBadgeAria}
                data-testid="shared-badge"
                data-variant={isOwnerOfShare ? 'owner' : 'recipient'}
              >
                <Icon name="users" size="sm" />
              </span>
            )}
          </span>
          <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
          <span
            className={cx(s.quantity, cards.stockQty, outOfStock && s.qtyOut, flashing && s.stockQtyFlash)}
            data-testid="row-quantity"
            data-out-of-stock={outOfStock || undefined}
          >
            {quantity} {t('common.unit')}
          </span>
        </span>

        {hasMeta && (
          <span
            className={s.meta}
            data-testid="consumption-row"
            title={stock.depletion_is_estimated ? t('inventory.depletionEstimatedAria') : undefined}
          >
            <span className={s.metaText}>
              {stock.depletion_is_estimated && (
                <Icon name="equal-approximately" size="sm" data-testid="estimated-icon" />
              )}
              {ownRate > 0 && (
                <span className={cards.consumptionOwn}>
                  {t('inventory.consumptionPerMonth', { rate: rate(ownRate) })}
                </span>
              )}
              {ownRate > 0 && sharedRate > 0 && ' + '}
              {sharedRate > 0 && <span>{t('inventory.consumptionShared', { rate: rate(sharedRate) })}</span>}

              {reasons.map((reason, index) => (
                <span key={reason.key} className={s.reasonItem}>
                  {(index > 0 || totalRate > 0) && (
                    <span className={s.separator} aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span
                    className={reason.tone === 'danger' ? s.reasonDanger : s.reasonWarning}
                    data-testid="row-reason"
                    data-kind={reason.kind}
                  >
                    {t(reason.key, reason.params)}
                  </span>
                </span>
              ))}
            </span>

            {/* A right column under the quantity: "which one runs out first" is
                answered by scanning. Out of stock there is nothing to date. */}
            {!outOfStock && stock.estimated_depletion_date && (
              <span
                className={cx(
                  s.depletion,
                  stock.stock_severity === 'low' && s.depletionWarning,
                  stock.stock_severity === 'critical' && s.depletionDanger,
                )}
                data-testid="depletion-date"
              >
                {t('inventory.depletionUntil', { date: formatShortDate(stock.estimated_depletion_date) })}
              </span>
            )}
          </span>
        )}
      </Link>
    </div>
  )
}
