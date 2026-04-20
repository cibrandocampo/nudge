import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../components/ConfirmModal'
import Icon from '../components/Icon'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useStock, useStockGroups } from '../hooks/useStock'
import { useStockConsumptions } from '../hooks/useEntries'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useDeleteStock } from '../hooks/mutations/useDeleteStock'
import { useDeleteStockLot } from '../hooks/mutations/useDeleteStockLot'
import { useUpdateStock } from '../hooks/mutations/useUpdateStock'
import cx from '../utils/cx'
import { formatAbsoluteDate } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './StockDetailPage.module.css'

function formatExpiry(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatDepletionDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function borderTokens(stock) {
  if (!stock || stock.quantity === 0) return { border: shared.cardBorderDanger, dot: shared.dotDanger }
  if (stock.quantity <= 3) return { border: shared.cardBorderWarning, dot: shared.dotWarning }
  return { border: shared.cardBorderSuccess, dot: shared.dotSuccess }
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
  const updateStock = useUpdateStock()
  const deleteStock = useDeleteStock()
  const createLot = useCreateStockLot()
  const deleteLot = useDeleteStockLot()

  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
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

  const startEditName = () => {
    setNameDraft(stock.name)
    setEditingName(true)
  }

  const saveName = async () => {
    const trimmed = nameDraft.trim()
    setEditingName(false)
    if (!trimmed || trimmed === stock.name) return
    try {
      await updateStock.mutateAsync({
        stockId,
        patch: { name: trimmed },
        updatedAt: stock.updated_at,
      })
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  const handleAddLot = async (e) => {
    e.preventDefault()
    const qty = parseInt(addForm.qty, 10)
    if (isNaN(qty) || qty < 0) return
    setAddForm((f) => ({ ...f, adding: true }))
    try {
      await createLot.mutateAsync({
        stockId,
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
      await deleteLot.mutateAsync({ stockId, lotId, updatedAt })
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  const doDeleteStock = async () => {
    setConfirmDelete(false)
    try {
      await deleteStock.mutateAsync({ stockId, updatedAt: stock.updated_at })
      navigate('/inventory')
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  return (
    <div className={s.container}>
      <div className={s.header}>
        <Link to="/inventory" className={s.backLink} aria-label={t('stockDetail.back')}>
          <Icon name="chevron-left" size="sm" />
          <span>{t('stockDetail.back')}</span>
        </Link>
      </div>

      <div className={cx(shared.card, tokens.border)}>
        <div className={shared.cardHeader}>
          <div className={shared.cardMeta}>
            {editingName ? (
              <input
                className={cx(shared.input, s.nameInput)}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                autoFocus
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
              />
            ) : (
              <button type="button" className={s.titleBtn} onClick={startEditName}>
                <span className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                  <span>{stock.name}</span>
                  <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
                  <Icon name="edit" size="sm" className={s.editHint} />
                </span>
              </button>
            )}
            <span className={shared.cardSubtitle}>
              <span className={cx(shared.dot, tokens.dot)} />
              <span className={shared.stockQty}>
                {stock.quantity} {t('common.total')}
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
            {groupName && <span className={shared.cardStockBadge}>{groupName}</span>}
            {stock.is_owner === false && stock.owner_username && (
              <span className={shared.sharedOwner}>{stock.owner_username}</span>
            )}
          </div>
        </div>
      </div>

      <section className={s.section}>
        <p className={shared.sectionTitle}>{t('stockDetail.lots')}</p>
        {stock.lots.length > 0 && (
          <div className={s.lotsList}>
            {stock.lots.map((lot) => (
              <div key={lot.id} className={shared.lotRow} data-testid="lot-row">
                <div className={shared.lotInfo}>
                  {lot.lot_number && <span className={shared.lotNumber}>{lot.lot_number}</span>}
                  <span className={shared.lotQty}>
                    {lot.quantity} {t('common.unit')}
                  </span>
                  <span className={shared.lotExpiry}>
                    {lot.expiry_date ? formatExpiry(lot.expiry_date) : t('inventory.noExpiry')}
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
            ))}
          </div>
        )}

        <form onSubmit={handleAddLot} className={s.addLotForm}>
          <div className={s.addLotRow}>
            <div className={s.addLotField}>
              <label className={s.fieldLabel}>{t('inventory.lotQty')} *</label>
              <input
                className={cx(shared.input, s.inputNarrow)}
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
            <div className={cx(s.addLotField, s.inputFlex)}>
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
          <button type="submit" className={s.primaryBtn} disabled={addForm.adding}>
            {addForm.adding ? t('inventory.adding') : t('inventory.addLot')}
          </button>
        </form>
      </section>

      {consumptions.length > 0 && (
        <section className={s.section}>
          <p className={shared.sectionTitle}>{t('stockDetail.recentConsumption')}</p>
          <ul className={s.consumptionList}>
            {consumptions.slice(0, 5).map((c) => (
              <li key={c.id} className={s.consumptionRow}>
                <span className={s.consumptionQty}>
                  {c.quantity} {t('common.unit')}
                </span>
                <span className={s.consumptionDate}>{formatAbsoluteDate(c.created_at)}</span>
                {c.consumed_by_username && <span className={shared.sharedOwner}>{c.consumed_by_username}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={cx(s.section, s.dangerZone)}>
        <p className={shared.sectionTitle}>{t('stockDetail.dangerZone')}</p>
        <button type="button" className={s.dangerBtn} onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size="sm" />
          {t('stockDetail.deleteStock')}
        </button>
      </section>

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
