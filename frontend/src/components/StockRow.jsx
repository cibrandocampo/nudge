import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
 * The row is one link to the product (T205). The consume button sits beside it
 * and not inside: a control nested in a link is invalid and unreachable by
 * assistive tech. E2E opens a product by the link's `row-open-detail` test id
 * (`helpers/navigation.js`; a label would break for a Spanish or Galician
 * profile) and consumes by the button's "Consume 1 unit" name.
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

  return (
    <div className={s.row} data-testid="product-card">
      <Link to={`/inventory/${stock.id}`} className={s.link} data-testid="row-open-detail">
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

      <div className={s.actions}>
        {/* Out of stock keeps the same button, greyed and disabled, so the
            column stays aligned and the row says "nothing to consume". */}
        <button
          type="button"
          className={cx(
            buttons.icon,
            buttons.outlined,
            s.consume,
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
      </div>
    </div>
  )
}
