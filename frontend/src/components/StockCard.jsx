import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import shared from '../styles/shared.module.css'
import s from './StockCard.module.css'

const MONTHLY_FACTOR = 30

function toMonthly(dailyRate) {
  const monthly = dailyRate * MONTHLY_FACTOR
  return monthly % 1 === 0 ? String(monthly) : monthly.toFixed(1)
}

function borderTokens(stock) {
  if (stock.stock_severity === 'out') {
    return { border: shared.cardBorderDanger, dot: shared.dotDanger }
  }
  if (stock.stock_severity === 'low') {
    return { border: shared.cardBorderWarning, dot: shared.dotWarning }
  }
  return { border: shared.cardBorderSuccess, dot: shared.dotSuccess }
}

export default function StockCard({ stock, consuming, flashing, onConsume }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tokens = borderTokens(stock)

  const goDetail = () => navigate(`/inventory/${stock.id}`)
  const stop = (e) => e.stopPropagation()

  const isShared = stock.shared_with?.length > 0 && stock.is_owner !== false
  const ownRate = stock.daily_consumption_own || 0
  const sharedRate = stock.daily_consumption_shared || 0
  const totalRate = ownRate + sharedRate

  return (
    <div className={cx(shared.card, shared.cardClickable, tokens.border)} data-testid="product-card" onClick={goDetail}>
      <div className={cx(shared.cardHeader, s.compactHeader)}>
        <div className={shared.cardMeta}>
          <span className={cx(shared.cardTitle, shared.cardTitleFlex)}>
            <span className={cx(shared.dot, tokens.dot)} />
            <span>{stock.name}</span>
            <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
          </span>
          <span className={shared.cardSubtitle}>
            <span className={cx(shared.stockQty, flashing && s.stockQtyFlash)}>
              {stock.quantity} {t('common.unit')}
            </span>
          </span>
          {stock.is_owner === false && stock.owner_username && (
            <span className={shared.sharedOwner}>{stock.owner_username}</span>
          )}
        </div>
        <div className={shared.cardActions} onClick={stop}>
          {isShared && (
            <span
              className={cx(shared.btnIcon, shared.btnIconShared, s.sharedBadge)}
              aria-label={t('sharing.sharedWith')}
              title={t('sharing.sharedWith')}
              data-testid="shared-badge"
            >
              <Icon name="users" size="sm" />
            </span>
          )}
          {stock.quantity > 0 && (
            <button
              type="button"
              className={cx(shared.btnIcon, shared.btnIconConsume, consuming && shared.disabled)}
              onClick={() => onConsume(stock)}
              disabled={consuming}
              aria-label={t('inventory.consumeTooltip')}
              title={t('inventory.consumeTooltip')}
            >
              <Icon name="package" className={shared.consumeBox} />
              <Icon name="arrow-down" className={shared.consumeArrow} />
            </button>
          )}
          <button
            type="button"
            className={cx(shared.btnIcon, shared.btnIconAction)}
            onClick={goDetail}
            aria-label={t('common.openDetail')}
            title={t('common.openDetail')}
          >
            <Icon name="chevron-right" size="sm" />
          </button>
        </div>
      </div>

      {/* Smart-hide: skip the lot block when it would only repeat the
       * header's total qty (single lot with no expiry and no lot_number).
       * To revert to "always show when there's at least one lot", replace
       * the next line with `stock.lots && stock.lots.length > 0 && (`. */}
      {(stock.lots?.length > 1 || Boolean(stock.lots?.[0]?.expiry_date) || Boolean(stock.lots?.[0]?.lot_number)) && (
        <div className={shared.cardLotsBlock}>
          {stock.lots.map((lot) => (
            <div key={lot.id} className={shared.cardLotRow} data-testid="card-lot-row">
              <div className={shared.cardLotMain}>
                <Icon name="package" size="sm" className={shared.cardLotIcon} />
                <span className={shared.cardLotQty}>
                  {lot.quantity} {t('common.unit')}
                </span>
              </div>
              <div className={shared.cardLotMeta}>
                {lot.expiry_date && (
                  <span className={shared.cardLotExpiry}>
                    {t('inventory.lotExpiryDate', {
                      date: formatShortDate(lot.expiry_date, { withDay: false }),
                    })}
                  </span>
                )}
                {lot.lot_number && <span className={shared.cardLotNumberPill}>{lot.lot_number}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalRate > 0 && (
        <div className={shared.consumptionRow} data-testid="consumption-row" onClick={stop}>
          {ownRate > 0 && (
            <span className={shared.consumptionOwn}>
              {t('inventory.consumptionPerMonth', { rate: toMonthly(ownRate) })}
            </span>
          )}
          {ownRate > 0 && sharedRate > 0 && ' + '}
          {sharedRate > 0 && <span>{t('inventory.consumptionShared', { rate: toMonthly(sharedRate) })}</span>}

          {stock.quantity === 0 ? (
            <span className={cx(shared.depletionEnd, shared.stockDepletionDanger)} data-testid="out-of-stock-footer">
              {t('inventory.outOfStockFooter')}
            </span>
          ) : (
            stock.estimated_depletion_date && (
              <span
                className={cx(
                  shared.depletionEnd,
                  stock.stock_severity === 'low' && shared.stockDepletionWarn,
                  stock.stock_severity === 'out' && shared.stockDepletionDanger,
                )}
                data-testid="depletion-date"
              >
                {t('inventory.depletionUntil', {
                  date: formatShortDate(stock.estimated_depletion_date),
                })}
              </span>
            )
          )}
        </div>
      )}
    </div>
  )
}
