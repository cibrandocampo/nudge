import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toMonthly } from '../utils/consumption'
import cx from '../utils/cx'
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
 * "Open details" label (`helpers/navigation.js`) and consumes by the −1
 * button's "Consume 1 unit" label, so both must keep their names.
 */
export default function StockRow({ stock, consuming, flashing, onConsume }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tokens = borderTokensFromStock(stock)

  const goDetail = () => navigate(`/inventory/${stock.id}`)
  const stop = (e) => e.stopPropagation()

  const quantity = stock.quantity_available ?? stock.quantity ?? 0

  // Owner sees the filled variant; recipient sees the outlined one — both
  // share the same `users` icon so the language is consistent across the app.
  const isShared = stock.shared_with?.length > 0 || stock.is_owner === false
  const isOwnerOfShare = stock.is_owner !== false
  const sharedBadgeAria = isOwnerOfShare
    ? t('sharing.sharedBadgeOwnerAria')
    : t('sharing.sharedBadgeRecipientAria', { owner: stock.owner_display_name ?? '' })

  const ownRate = stock.daily_consumption_own || 0
  const sharedRate = stock.daily_consumption_shared || 0
  const totalRate = ownRate + sharedRate

  // One warning at most, and it comes from `expiry_severity` rather than
  // `stock_severity`: the dot on line 1 already carries the stock axis, and
  // the two were deliberately decoupled (see `stockSeverity.js`). 'reached'
  // outranks 'soon' — the backend awards that precedence, not this component.
  const expiryWarning =
    stock.expiry_severity === 'reached'
      ? { key: 'inventory.rowExpiryReached', className: s.expiryDanger }
      : stock.expiry_severity === 'soon'
        ? { key: 'inventory.rowExpiringSoon', className: s.expiryWarning }
        : null

  return (
    <div className={s.row} data-testid="product-card" onClick={goDetail}>
      <div className={s.main}>
        <span className={cx(cards.dot, tokens.dot)} />
        <span className={s.name}>{stock.name}</span>
        <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
        <span className={s.qtyGroup}>
          <span className={cx(cards.stockQty, flashing && s.stockQtyFlash)}>
            {quantity} {t('common.unit')}
          </span>
          {(stock.quantity_expired ?? 0) > 0 && (
            <span className={cards.stockQtyExpired}>
              {' '}
              ({t('inventory.expiredCount', { count: stock.quantity_expired })})
            </span>
          )}
        </span>
        <div className={s.actions} onClick={stop}>
          {isShared && (
            <span
              className={cx(
                buttons.btnIcon,
                isOwnerOfShare ? buttons.btnIconShared : buttons.btnIconSharedRecipient,
                s.sharedBadge,
              )}
              aria-label={sharedBadgeAria}
              title={sharedBadgeAria}
              data-testid="shared-badge"
              data-variant={isOwnerOfShare ? 'owner' : 'recipient'}
            >
              <Icon name="users" size="sm" />
            </span>
          )}
          {quantity > 0 && (
            <button
              type="button"
              className={cx(buttons.btnIcon, buttons.btnIconConsume, consuming && buttons.disabled)}
              onClick={() => onConsume(stock)}
              disabled={consuming}
              aria-label={t('inventory.consumeTooltip')}
              title={t('inventory.consumeTooltip')}
            >
              <Icon name="package" className={buttons.consumeBox} />
              <Icon name="arrow-down" className={buttons.consumeArrow} />
            </button>
          )}
          <button
            type="button"
            className={cx(buttons.btnIcon, buttons.btnIconAction)}
            onClick={goDetail}
            aria-label={t('common.openDetail')}
            title={t('common.openDetail')}
          >
            <Icon name="chevron-right" size="sm" />
          </button>
        </div>
      </div>

      {totalRate > 0 && (
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

          {expiryWarning && (
            <span className={expiryWarning.className} data-testid="row-expiry-warning">
              {t(expiryWarning.key)}
            </span>
          )}

          {/* Right-aligned so the dates form a column down the list: "which
              one runs out first" is answered by scanning, not by reading. */}
          {quantity === 0 ? (
            <span className={cx(s.depletion, s.depletionDanger)} data-testid="out-of-stock-footer">
              {t('inventory.outOfStockFooter')}
            </span>
          ) : (
            stock.estimated_depletion_date && (
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
            )
          )}
        </div>
      )}
    </div>
  )
}
