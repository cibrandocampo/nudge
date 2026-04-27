import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../components/ConfirmModal'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStock, useStockGroups } from '../hooks/useStock'
import { useStockConsumptions } from '../hooks/useEntries'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useDeleteStock } from '../hooks/mutations/useDeleteStock'
import { useDeleteStockLot } from '../hooks/mutations/useDeleteStockLot'
import cx from '../utils/cx'
import { groupEntriesByDate } from '../utils/historyGroups'
import { parseIntSafe } from '../utils/number'
import { formatShortDate } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './StockDetailPage.module.css'

function borderTokens(stock) {
  if (!stock || stock.stock_severity === 'out') {
    return { border: shared.cardBorderDanger, dot: shared.dotDanger }
  }
  if (stock.stock_severity === 'low') {
    return { border: shared.cardBorderWarning, dot: shared.dotWarning }
  }
  return { border: shared.cardBorderSuccess, dot: shared.dotSuccess }
}

// Tri-state lot expiry severity derived from the lot's own expiry_date.
// Independent of stock.expiring_lots (which the InventoryPage alert blocks
// consume). Returned values match the data-expiring attribute on lot rows.
function lotExpirySeverity(lot, today) {
  if (lot.expiry_date == null) return 'none'
  const expiry = new Date(lot.expiry_date)
  if (expiry <= today) return 'reached'
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + 30)
  if (expiry < cutoff) return 'soon'
  return 'none'
}

export default function StockDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { showToast } = useToast()

  const stockId = Number(id)
  const { data: stock, isLoading, isError, error } = useStock(stockId)
  const { data: groups = [] } = useStockGroups()
  const { data: consumptions = [] } = useStockConsumptions({ stock: String(stockId), enabled: !isNaN(stockId) })
  const deleteStock = useDeleteStock()
  const createLot = useCreateStockLot()
  const deleteLot = useDeleteStockLot()
  const reachable = useServerReachable()

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRemoveLot, setConfirmRemoveLot] = useState(null)
  const [addForm, setAddForm] = useState({ qty: '', expiry: '', lotNumber: '', adding: false })

  if (isLoading) return <div className={shared.spinner} data-testid="spinner" />
  if (isError) {
    if (error?.status === 404) return <p className={shared.muted}>{t('stockDetail.notFound')}</p>
    return <p className={shared.muted}>{t('common.error')}</p>
  }
  if (!stock) return <p className={shared.muted}>{t('stockDetail.notFound')}</p>

  const tokens = borderTokens(stock)
  const groupName = groups.find((g) => g.id === stock.group)?.name
  // Local-midnight today for lot expiry comparison; matches the backend's
  // `date.today()` semantics (a lot expiring today reads as 'reached').
  const today = new Date(new Date().toISOString().slice(0, 10))

  const handleAddLot = async (e) => {
    e.preventDefault()
    const qty = parseIntSafe(addForm.qty, -1)
    if (qty < 0) return
    setAddForm((f) => ({ ...f, adding: true }))
    try {
      await createLot.mutateAsync({
        stockId,
        stockName: stock.name,
        quantity: qty,
        expiryDate: addForm.expiry,
        lotNumber: addForm.lotNumber.trim(),
      })
      setAddForm({ qty: '', expiry: '', lotNumber: '', adding: false })
    } catch {
      setAddForm((f) => ({ ...f, adding: false }))
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  const doRemoveLot = async () => {
    const { lotId, updatedAt } = confirmRemoveLot
    setConfirmRemoveLot(null)
    try {
      await deleteLot.mutateAsync({ stockId, stockName: stock.name, lotId, updatedAt })
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  const doDeleteStock = async () => {
    setConfirmDelete(false)
    try {
      await deleteStock.mutateAsync({ stockId, stockName: stock.name, updatedAt: stock.updated_at })
      navigate('/inventory')
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  const isOwner = stock.is_owner !== false

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <Link to="/inventory" className={s.backLink} aria-label={t('common.backToInventory')}>
          <span>{t('common.backToInventory')}</span>
        </Link>
        <div className={s.topActions}>
          <Link
            to={`/history?type=consumptions&stock=${stockId}`}
            className={cx(shared.btnAdd, shared.btnAddSecondary)}
            aria-label={t('stockDetail.viewAll')}
            title={t('stockDetail.viewAll')}
          >
            <Icon name="history" />
          </Link>
          {isOwner && (
            <>
              <button
                type="button"
                className={cx(shared.btnAdd, shared.btnAddDanger)}
                onClick={() => setConfirmDelete(true)}
                aria-label={t('stockDetail.deleteStock')}
                title={t('stockDetail.deleteStock')}
              >
                <Icon name="trash" />
              </button>
              <button
                type="button"
                className={cx(shared.btnAdd, !reachable && shared.disabled)}
                onClick={() => navigate(`/inventory/${stockId}/edit`)}
                disabled={!reachable}
                aria-label={t('stockDetail.edit')}
                title={!reachable ? t('offline.requiresConnection') : t('stockDetail.edit')}
              >
                <Icon name="pencil" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className={cx(shared.card, tokens.border)}>
        <div className={shared.cardHeader}>
          <div className={shared.cardMeta}>
            <span className={cx(shared.cardTitle, shared.cardTitleFlex)}>
              <span>{stock.name}</span>
              <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
            </span>
            <span className={shared.cardSubtitle}>
              <span className={cx(shared.dot, tokens.dot)} />
              <span className={shared.stockQty}>
                {stock.quantity} {t('common.total')}
              </span>
              {stock.estimated_depletion_date && (
                <span
                  className={cx(
                    shared.stockDepletion,
                    stock.stock_severity === 'low' && shared.stockDepletionWarn,
                    stock.stock_severity === 'out' && shared.stockDepletionDanger,
                  )}
                  data-testid="depletion-date"
                >
                  {t('inventory.depletionDate', { date: formatShortDate(stock.estimated_depletion_date) })}
                </span>
              )}
            </span>
            {groupName && <span className={shared.cardStockBadge}>{groupName}</span>}
            {stock.is_owner === false && stock.owner_username && (
              <span className={shared.sharedOwner}>{stock.owner_username}</span>
            )}
          </div>
        </div>
      </div>

      <section className={s.section}>
        <p className={shared.sectionTitle}>{t('stockDetail.lots')}</p>
        <div className={s.lotsCard}>
          {stock.lots.length > 0 && (
            <div className={s.lotsList}>
              {stock.lots.map((lot) => {
                const sev = lotExpirySeverity(lot, today)
                return (
                  <div key={lot.id} className={s.lotRow} data-testid="lot-row" data-expiring={sev}>
                    <div className={shared.lotInfo}>
                      {lot.lot_number && <span className={shared.lotNumber}>{lot.lot_number}</span>}
                      <span className={shared.lotQty}>
                        {lot.quantity} {t('common.unit')}
                      </span>
                      <span className={shared.lotExpiry}>
                        {lot.expiry_date
                          ? formatShortDate(lot.expiry_date, { withDay: false })
                          : t('inventory.noExpiry')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={cx(shared.btnIcon, shared.btnIconDelete)}
                      onClick={() => setConfirmRemoveLot({ lotId: lot.id, updatedAt: lot.updated_at })}
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

          <form onSubmit={handleAddLot} className={s.addLotForm}>
            <div className={s.addLotRow}>
              <div className={s.addLotField}>
                <label className={s.fieldLabel}>{t('inventory.lotQty')} *</label>
                <input
                  className={shared.input}
                  type="number"
                  min={0}
                  placeholder="0"
                  value={addForm.qty}
                  onChange={(e) => setAddForm((f) => ({ ...f, qty: e.target.value }))}
                  required
                />
              </div>
              <div className={s.addLotField}>
                <label className={s.fieldLabel}>{t('inventory.lotExpiry')}</label>
                <input
                  className={shared.input}
                  type="date"
                  value={addForm.expiry}
                  onChange={(e) => setAddForm((f) => ({ ...f, expiry: e.target.value }))}
                />
              </div>
              <div className={s.addLotField}>
                <label className={s.fieldLabel}>{t('inventory.lotNumber')}</label>
                <input
                  className={shared.input}
                  type="text"
                  placeholder={t('inventory.lotNumber')}
                  value={addForm.lotNumber}
                  onChange={(e) => setAddForm((f) => ({ ...f, lotNumber: e.target.value }))}
                />
              </div>
            </div>
            <button type="submit" className={cx(shared.btnConfirm, s.submitBtn)} disabled={addForm.adding}>
              {addForm.adding ? t('inventory.adding') : t('inventory.addLot')}
            </button>
          </form>
        </div>
      </section>

      {consumptions.length > 0 && (
        <section className={s.section}>
          <p className={shared.sectionTitle}>{t('stockDetail.recentConsumption')}</p>
          <div className={s.entryList}>
            {groupEntriesByDate(consumptions.slice(0, 5).map((c) => ({ ...c, _type: 'consumption' }))).map(
              ({ dateLabel, items }) => (
                <section key={dateLabel} className={s.dayGroup}>
                  <p className={s.dayHeader}>{dateLabel}</p>
                  <div className={s.dayList}>
                    {items.map((entry) => (
                      <HistoryEntryCard key={entry.id} entry={entry} showTitle={false} compact />
                    ))}
                  </div>
                </section>
              ),
            )}
          </div>
        </section>
      )}

      {confirmRemoveLot && (
        <ConfirmModal
          message={t('inventory.confirmDeleteLot')}
          onConfirm={doRemoveLot}
          onCancel={() => setConfirmRemoveLot(null)}
          confirmLabel={t('inventory.deleteTooltip')}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          message={t('inventory.confirmDelete', { name: stock.name })}
          onConfirm={doDeleteStock}
          onCancel={() => setConfirmDelete(false)}
          confirmLabel={t('stockDetail.deleteStock')}
        />
      )}
    </div>
  )
}
