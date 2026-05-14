import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { borderTokensFromStock, iconClassForLot, lotExpirySeverity } from '../utils/stockSeverity'
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

export default function StockCard({ stock, consuming, flashing, onConsume }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tokens = borderTokensFromStock(stock)
  // UTC-midnight today for lot expiry comparison; mirrors StockDetailPage.
  const today = new Date(new Date().toISOString().slice(0, 10))

  const goDetail = () => navigate(`/inventory/${stock.id}`)
  const stop = (e) => e.stopPropagation()

  // Owner sees the filled variant; recipient sees the outlined one — both
  // share the same `users` icon so the language is consistent across cards.
  const isShared = stock.shared_with?.length > 0 || stock.is_owner === false
  const isOwnerOfShare = stock.is_owner !== false
  const sharedBadgeAria = isOwnerOfShare
    ? t('sharing.sharedBadgeOwnerAria')
    : t('sharing.sharedBadgeRecipientAria', { owner: stock.owner_display_name ?? '' })
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
              {stock.quantity_available ?? stock.quantity ?? 0} {t('common.unit')}
            </span>
            {(stock.quantity_expired ?? 0) > 0 && (
              <span className={shared.stockQtyExpired}>
                {' '}
                ({t('inventory.expiredCount', { count: stock.quantity_expired })})
              </span>
            )}
          </span>
        </div>
        <div className={shared.cardActions} onClick={stop}>
          {isShared && (
            <span
              className={cx(
                shared.btnIcon,
                isOwnerOfShare ? shared.btnIconShared : shared.btnIconSharedRecipient,
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
          {(stock.quantity_available ?? stock.quantity ?? 0) > 0 && (
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
        <div className={shared.cardLotsBlock} data-with-pills={stock.lots.some((l) => l.lot_number) || undefined}>
          {stock.lots.map((lot) => {
            const sev = lotExpirySeverity(lot, today)
            return (
              <div key={lot.id} className={shared.cardLotRow} data-testid="card-lot-row" data-expiring={sev}>
                <div className={shared.cardLotMain}>
                  <Icon name="package" size="sm" className={cx(shared.cardLotIcon, iconClassForLot(lot, today))} />
                  <span className={cx(shared.cardLotQty, sev === 'reached' && shared.cardLotQtyExpired)}>
                    {lot.quantity} {t('common.unit')}
                  </span>
                </div>
                <div className={shared.cardLotMeta}>
                  {/* Date and pill render in fixed grid columns (cardLotsBlock is
                      a 3-col grid; cardLotMeta has display:contents, so these
                      spans land directly in the parent grid). DOM order is
                      irrelevant — column placement is via grid-column. */}
                  {lot.expiry_date && (
                    <span className={cx(shared.cardLotExpiry, iconClassForLot(lot, today))}>
                      {t('inventory.lotExpiryDate', {
                        date: formatShortDate(lot.expiry_date),
                      })}
                    </span>
                  )}
                  {lot.lot_number && <span className={shared.cardLotNumberPill}>{lot.lot_number}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {totalRate > 0 && (
        <div
          className={shared.consumptionRow}
          data-testid="consumption-row"
          title={stock.depletion_is_estimated ? t('inventory.depletionEstimatedAria') : undefined}
          onClick={stop}
        >
          {stock.depletion_is_estimated && <Icon name="equal-approximately" size="sm" data-testid="estimated-icon" />}
          {ownRate > 0 && (
            <span className={shared.consumptionOwn}>
              {t('inventory.consumptionPerMonth', { rate: toMonthly(ownRate) })}
            </span>
          )}
          {ownRate > 0 && sharedRate > 0 && ' + '}
          {sharedRate > 0 && <span>{t('inventory.consumptionShared', { rate: toMonthly(sharedRate) })}</span>}

          {(stock.quantity_available ?? stock.quantity ?? 0) === 0 ? (
            <span className={cx(shared.depletionEnd, shared.stockDepletionDanger)} data-testid="out-of-stock-footer">
              {t('inventory.outOfStockFooter')}
            </span>
          ) : (
            stock.estimated_depletion_date && (
              <span
                className={cx(
                  shared.depletionEnd,
                  stock.stock_severity === 'low' && shared.stockDepletionWarn,
                  stock.stock_severity === 'critical' && shared.stockDepletionDanger,
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
