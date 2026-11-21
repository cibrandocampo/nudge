import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toMonthly } from '../utils/consumption'
import cx from '../utils/cx'
import { stockRowReasons } from '../utils/stockAlerts'
import { borderTokensFromStock } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import s from './StockRow.module.css'

/**
 * A stock as one compact row, the inventory list's unit after T091.
 *
 * The card this replaced rendered a detail view N times: 105–160 px each, with
 * a height that varied with the number of batches, so twenty products came to
 * ~2 600 px and nothing in the list could be found by scanning. Here the
 * per-batch breakdown moves to the detail page — where it was always better —
 * and the row keeps only what answers the two questions the list is for: is
 * this one in trouble, and do I need to buy more.
 *
 * Line 1 is always there. Line 2 appears only when there is a consumption
 * rate to report, on the same guard the card used, so products with no routine
 * and no recent consumption stay a single 44 px line.
 *
 * The interaction model is deliberately the card's, unchanged: the row is a
 * clickable container, the actions inside stop propagation, and the chevron is
 * the keyboard-reachable route to the detail. E2E navigates by that button's
 * `row-open-detail` test id (`helpers/navigation.js`; a label would break for
 * a Spanish or Galician profile) and consumes by the −1 button's "Consume 1
 * unit" label, so both must keep their names.
 */
export default function StockRow({ stock, consuming, flashing, onConsume }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tokens = borderTokensFromStock(stock)

  const goDetail = () => navigate(`/inventory/${stock.id}`)
  const stop = (e) => e.stopPropagation()

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

  return (
    <div className={s.row} data-testid="product-card" onClick={goDetail}>
      <div className={s.main}>
        <span className={cx(cards.dot, tokens.dot)} />
        <span className={s.nameGroup}>
          <span className={s.name}>{stock.name}</span>
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
        <span className={s.qtyGroup}>
          <span
            className={cx(cards.stockQty, outOfStock && s.qtyOut, flashing && s.stockQtyFlash)}
            data-testid="row-quantity"
            data-out-of-stock={outOfStock || undefined}
          >
            {quantity} {t('common.unit')}
          </span>
          {/* Expired units are a reason on line 2 ("1 expired"), not a
              qualifier here: next to the quantity they squeezed the name. */}
        </span>
        <div className={s.actions} onClick={stop}>
          {/* Out of stock keeps the same button, greyed and disabled, so the
              action column stays aligned down the list and the row says
              "nothing to consume" rather than losing a control. */}
          <button
            type="button"
            className={cx(
              buttons.icon,
              buttons.iconFilled,
              outOfStock && s.consumeEmpty,
              consuming && buttons.disabled,
            )}
            onClick={() => onConsume(stock)}
            disabled={outOfStock || consuming}
            aria-label={outOfStock ? t('inventory.consumeEmpty') : t('inventory.consumeTooltip')}
            title={outOfStock ? t('inventory.consumeEmpty') : t('inventory.consumeTooltip')}
            data-testid="row-consume"
          >
            <Icon name="package" className={buttons.consumeBox} />
            <Icon name="arrow-down" className={buttons.consumeArrow} />
          </button>
          <button
            type="button"
            className={cx(buttons.icon, s.detailChevron)}
            onClick={goDetail}
            aria-label={t('common.openDetail')}
            title={t('common.openDetail')}
            data-testid="row-open-detail"
          >
            <Icon name="chevron-right" size="sm" />
          </button>
        </div>
      </div>

      {(totalRate > 0 || reasons.length > 0) && (
        <div
          className={s.meta}
          data-testid="consumption-row"
          title={stock.depletion_is_estimated ? t('inventory.depletionEstimatedAria') : undefined}
        >
          {stock.depletion_is_estimated && <Icon name="equal-approximately" size="sm" data-testid="estimated-icon" />}
          {ownRate > 0 && (
            <span className={cards.consumptionOwn}>
              {t('inventory.consumptionPerMonth', { rate: toMonthly(ownRate) })}
            </span>
          )}
          {ownRate > 0 && sharedRate > 0 && ' + '}
          {sharedRate > 0 && <span>{t('inventory.consumptionShared', { rate: toMonthly(sharedRate) })}</span>}

          {reasons.map((reason) => (
            <span
              key={reason.key}
              className={reason.tone === 'danger' ? s.reasonDanger : s.reasonWarning}
              data-testid="row-reason"
              data-kind={reason.kind}
            >
              {t(reason.key, reason.params)}
            </span>
          ))}

          {/* Right-aligned so the dates form a column down the list: "which
              one runs out first" is answered by scanning, not by reading. Out
              of stock there is nothing to date: the red quantity says it. */}
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
        </div>
      )}
    </div>
  )
}
