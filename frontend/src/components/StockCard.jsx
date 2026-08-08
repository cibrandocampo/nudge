import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { groupLots } from '../utils/lotsForSelection'
import { borderTokensFromStock } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import LotRow, { LotRowList } from './LotRow'
import SyncStatusBadge from './SyncStatusBadge'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
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
  // Same grouping as the detail page and the consumption modals: a batch is
  // one line, however many boxes of it there are. `minQuantity: 0` shows
  // exactly what the server sent (an emptied lot kept alive by bulk_create).
  const lotGroups = groupLots(stock.lots ?? [], { minQuantity: 0 })

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
    <div className={cx(cards.card, cards.cardClickable, tokens.border)} data-testid="product-card" onClick={goDetail}>
      <div className={cx(cards.cardHeader, s.compactHeader)}>
        <div className={cards.cardMeta}>
          <span className={cx(cards.cardTitle, cards.cardTitleFlex)}>
            <span className={cx(cards.dot, tokens.dot)} />
            <span>{stock.name}</span>
            <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
          </span>
          <span className={cards.cardSubtitle}>
            <span className={cx(cards.stockQty, flashing && s.stockQtyFlash)}>
              {stock.quantity_available ?? stock.quantity ?? 0} {t('common.unit')}
            </span>
            {(stock.quantity_expired ?? 0) > 0 && (
              <span className={cards.stockQtyExpired}>
                {' '}
                ({t('inventory.expiredCount', { count: stock.quantity_expired })})
              </span>
            )}
          </span>
        </div>
        <div className={cards.cardActions} onClick={stop}>
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
          {(stock.quantity_available ?? stock.quantity ?? 0) > 0 && (
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

      {/* Smart-hide: skip the lot block when it would only repeat the
       * header's total qty (single lot with no expiry and no lot_number).
       * To revert to "always show when there's at least one lot", replace
       * the next line with `stock.lots && stock.lots.length > 0 && (`. */}
      {(lotGroups.length > 1 || Boolean(lotGroups[0]?.expiry_date) || Boolean(lotGroups[0]?.lot_number)) && (
        <LotRowList lots={stock.lots} className={s.lotsBlock}>
          {/* One row per batch, not per database row: several scanned boxes of
              the same batch are one line here. The individual serials live in
              the stock detail, where they can be expanded. No trailing control:
              this list is read-only, the detail page is where lots are edited. */}
          {lotGroups.map((group) => (
            <LotRow key={group.key} group={group} today={today} testId="card-lot-row" />
          ))}
        </LotRowList>
      )}

      {totalRate > 0 && (
        <div
          className={cards.consumptionRow}
          data-testid="consumption-row"
          title={stock.depletion_is_estimated ? t('inventory.depletionEstimatedAria') : undefined}
          onClick={stop}
        >
          {stock.depletion_is_estimated && <Icon name="equal-approximately" size="sm" data-testid="estimated-icon" />}
          {ownRate > 0 && (
            <span className={cards.consumptionOwn}>
              {t('inventory.consumptionPerMonth', { rate: toMonthly(ownRate) })}
            </span>
          )}
          {ownRate > 0 && sharedRate > 0 && ' + '}
          {sharedRate > 0 && <span>{t('inventory.consumptionShared', { rate: toMonthly(sharedRate) })}</span>}

          {(stock.quantity_available ?? stock.quantity ?? 0) === 0 ? (
            <span className={cx(cards.depletionEnd, cards.stockDepletionDanger)} data-testid="out-of-stock-footer">
              {t('inventory.outOfStockFooter')}
            </span>
          ) : (
            stock.estimated_depletion_date && (
              <span
                className={cx(
                  cards.depletionEnd,
                  stock.stock_severity === 'low' && cards.stockDepletionWarn,
                  stock.stock_severity === 'critical' && cards.stockDepletionDanger,
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
