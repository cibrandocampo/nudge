import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import Icon from './Icon'
import SyncStatusBadge from './SyncStatusBadge'
import shared from '../styles/shared.module.css'
import s from './StockCard.module.css'

function formatExpiry(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatDepletionDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

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

export default function StockCard({
  stock,
  consuming,
  flashing,
  canShare,
  onConsume,
  onAssignGroup,
  onToggleShare,
  addLotForm,
  onLotFieldChange,
  onToggleAddLot,
  onSubmitAddLot,
  onDeleteLot,
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tokens = borderTokens(stock)

  const goDetail = () => navigate(`/inventory/${stock.id}`)
  const stop = (e) => e.stopPropagation()

  const isShared = stock.shared_with?.length > 0
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
                {t('inventory.depletionDate', { date: formatDepletionDate(stock.estimated_depletion_date) })}
              </span>
            )}
          </span>
          {stock.is_owner === false && stock.owner_username && (
            <span className={shared.sharedOwner}>{stock.owner_username}</span>
          )}
        </div>
        <div className={shared.cardActions} onClick={stop}>
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
          {stock.is_owner !== false && (
            <button
              type="button"
              className={cx(shared.btnIcon, shared.btnIconAction)}
              onClick={() => onAssignGroup(stock.id)}
              aria-label={t('inventory.assignGroup')}
              title={t('inventory.assignGroup')}
            >
              <Icon name="tag" size="sm" />
            </button>
          )}
          {stock.is_owner !== false && canShare && (
            <button
              type="button"
              className={cx(shared.btnIcon, isShared ? shared.btnIconShared : shared.btnIconShare)}
              onClick={() => onToggleShare(stock.id)}
              aria-label={t('sharing.shareWith')}
              title={t('sharing.shareWith')}
            >
              <Icon name={isShared ? 'users' : 'user-plus'} size="sm" />
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

      {stock.lots.length > 0 && (
        <div onClick={stop}>
          {stock.lots.map((lot) => {
            const expiring = stock.expiring_lots.some((el) => el.id === lot.id)
            return (
              <div
                key={lot.id}
                className={shared.lotRow}
                data-testid="lot-row"
                data-expiring={expiring ? 'true' : 'false'}
              >
                <div className={shared.lotInfo}>
                  {lot.lot_number && <span className={shared.lotNumber}>{lot.lot_number}</span>}
                  <span className={shared.lotQty}>
                    {lot.quantity} {t('common.unit')}
                  </span>
                  <span className={cx(shared.lotExpiry, expiring && s.lotExpiryDanger)}>
                    {lot.expiry_date ? formatExpiry(lot.expiry_date) : t('inventory.noExpiry')}
                    {expiring && (
                      <>
                        {' '}
                        <Icon name="alert-triangle" size="sm" />
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className={cx(shared.btnIcon, shared.btnIconDelete)}
                  onClick={() => onDeleteLot(stock.id, lot.id, lot.updated_at)}
                  aria-label={t('inventory.deleteTooltip')}
                  title={t('inventory.deleteTooltip')}
                >
                  <Icon name="trash" size="sm" />
                </button>
              </div>
            )
          })}
        </div>
      )}

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

      <div onClick={stop} className={s.addLotWrap}>
        {addLotForm.show ? (
          <form onSubmit={onSubmitAddLot} className={s.addLotForm}>
            <div className={s.addLotRow}>
              <div className={s.addLotField}>
                <label className={s.fieldLabel}>{t('inventory.lotQty')} *</label>
                <input
                  className={cx(shared.input, s.inputNarrow)}
                  type="number"
                  min={0}
                  placeholder="0"
                  value={addLotForm.qty}
                  onChange={(e) => onLotFieldChange('qty', e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className={s.addLotField}>
                <label className={s.fieldLabel}>{t('inventory.lotExpiry')}</label>
                <input
                  className={shared.input}
                  type="date"
                  value={addLotForm.expiry}
                  onChange={(e) => onLotFieldChange('expiry', e.target.value)}
                />
              </div>
              <div className={cx(s.addLotField, s.inputFlex)}>
                <label className={s.fieldLabel}>{t('inventory.lotNumber')}</label>
                <input
                  className={shared.input}
                  type="text"
                  placeholder={t('inventory.lotNumber')}
                  value={addLotForm.lotNumber}
                  onChange={(e) => onLotFieldChange('lotNumber', e.target.value)}
                />
              </div>
            </div>
            <div className={s.addLotActions}>
              <button type="submit" className={s.createBtn} disabled={addLotForm.adding}>
                {addLotForm.adding ? t('inventory.adding') : t('inventory.addLot')}
              </button>
              <button type="button" className={s.cancelBtn} onClick={onToggleAddLot}>
                {t('inventory.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className={s.addLotBtn} onClick={onToggleAddLot}>
            + {t('inventory.addLot')}
          </button>
        )}
      </div>
    </div>
  )
}
