import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import shared from '../styles/shared.module.css'
import s from './StockCard.module.css'

function formatRate(rate) {
  return rate % 1 === 0 ? String(rate) : rate.toFixed(1)
}

function borderTokens(stock) {
  if (stock.quantity === 0) {
    return { border: shared.cardBorderDanger, dot: shared.dotDanger }
  }
  if (stock.quantity <= 3) {
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
  const totalRate = (stock.daily_consumption_own || 0) + (stock.daily_consumption_shared || 0)

  return (
    <div className={cx(shared.card, shared.cardClickable, tokens.border)} data-testid="product-card" onClick={goDetail}>
      <div className={shared.cardHeader}>
        <div className={shared.cardMeta}>
          <span className={cx(shared.cardTitle, shared.cardTitleFlex)}>
            <span>{stock.name}</span>
            <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
          </span>
          <span className={shared.cardSubtitle}>
            <span className={cx(shared.dot, tokens.dot)} />
            <span className={cx(shared.stockQty, flashing && s.stockQtyFlash)}>
              ({stock.quantity} {t('common.total')})
            </span>
            {stock.estimated_depletion_date && (
              <span
                className={cx(shared.stockDepletion, stock.is_low_stock && shared.stockDepletionWarn)}
                data-testid="depletion-date"
              >
                {t('inventory.depletionDate', { date: formatShortDate(stock.estimated_depletion_date) })}
              </span>
            )}
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

      {totalRate > 0 && (
        <div className={shared.consumptionRow} data-testid="consumption-row" onClick={stop}>
          {stock.daily_consumption_own && (
            <span className={shared.consumptionOwn}>
              {t('inventory.consumptionPerDay', { rate: formatRate(stock.daily_consumption_own) })}
            </span>
          )}
          {stock.daily_consumption_own && stock.daily_consumption_shared && ' + '}
          {stock.daily_consumption_shared && (
            <span>{t('inventory.consumptionShared', { rate: formatRate(stock.daily_consumption_shared) })}</span>
          )}
        </div>
      )}
    </div>
  )
}
