import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import cx from '../utils/cx'
import ConfirmModal from '../components/ConfirmModal'
import shared from '../styles/shared.module.css'
import s from './InventoryPage.module.css'

function formatExpiry(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export default function InventoryPage() {
  const { t } = useTranslation()
  const [stocks, setStocks] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmRemove, setConfirmRemove] = useState(null) // { id, name }
  const [confirmRemoveLot, setConfirmRemoveLot] = useState(null) // { stockId, lotId }

  // New stock form
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const [actionError, setActionError] = useState(null)

  // Per-stock "add lot" form: { [stockId]: { show, qty, expiry, lotNumber, adding } }
  const [addLot, setAddLot] = useState({})

  const load = () => {
    setLoading(true)
    api
      .get('/stock/')
      .then((r) => r.json())
      .then((d) => setStocks(d.results ?? d))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  // ── Stock CRUD ────────────────────────────────────────────────────────────

  const create = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setActionError(null)
    try {
      const res = await api.post('/stock/', { name: newName.trim() })
      if (!res.ok) throw new Error()
      const item = await res.json()
      setStocks((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))
      setNewName('')
      setShowNew(false)
    } catch {
      setActionError(t('common.actionError'))
    } finally {
      setCreating(false)
    }
  }

  const doRemoveStock = async () => {
    const { id } = confirmRemove
    setConfirmRemove(null)
    setActionError(null)
    try {
      const res = await api.delete(`/stock/${id}/`)
      if (!res.ok && res.status !== 204) throw new Error()
      setStocks((prev) => prev.filter((st) => st.id !== id))
    } catch {
      setActionError(t('common.actionError'))
    }
  }

  // ── Lot CRUD ──────────────────────────────────────────────────────────────

  const lotForm = (stockId) => addLot[stockId] ?? { show: false, qty: '', expiry: '', lotNumber: '', adding: false }

  const setLotField = (stockId, field, value) =>
    setAddLot((prev) => ({ ...prev, [stockId]: { ...lotForm(stockId), [field]: value } }))

  const toggleAddLot = (stockId) =>
    setAddLot((prev) => ({ ...prev, [stockId]: { ...lotForm(stockId), show: !lotForm(stockId).show } }))

  const submitAddLot = async (e, stockId) => {
    e.preventDefault()
    const form = lotForm(stockId)
    const qty = parseInt(form.qty, 10)
    if (isNaN(qty) || qty < 0) return
    setLotField(stockId, 'adding', true)
    setActionError(null)
    const payload = { quantity: qty }
    if (form.expiry) payload.expiry_date = form.expiry
    if (form.lotNumber.trim()) payload.lot_number = form.lotNumber.trim()
    try {
      const res = await api.post(`/stock/${stockId}/lots/`, payload)
      if (!res.ok) throw new Error()
      const stockRes = await api.get(`/stock/${stockId}/`)
      if (stockRes.ok) {
        const updated = await stockRes.json()
        setStocks((prev) => prev.map((st) => (st.id === stockId ? updated : st)))
      }
      setAddLot((prev) => ({ ...prev, [stockId]: { show: false, qty: '', expiry: '', lotNumber: '', adding: false } }))
    } catch {
      setLotField(stockId, 'adding', false)
      setActionError(t('common.actionError'))
    }
  }

  const doRemoveLot = async () => {
    const { stockId, lotId } = confirmRemoveLot
    setConfirmRemoveLot(null)
    setActionError(null)
    try {
      const res = await api.delete(`/stock/${stockId}/lots/${lotId}/`)
      if (!res.ok && res.status !== 204) throw new Error()
      const stockRes = await api.get(`/stock/${stockId}/`)
      if (stockRes.ok) {
        const updated = await stockRes.json()
        setStocks((prev) => prev.map((st) => (st.id === stockId ? updated : st)))
      }
    } catch {
      setActionError(t('common.actionError'))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <p className={shared.muted}>{t('common.loading')}</p>

  const expiringStocks = stocks.filter((st) => st.has_expiring_lots)

  return (
    <div className={s.container}>
      {actionError && <p className={shared.error}>{actionError}</p>}
      {/* Top bar */}
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('inventory.title')}</h1>
        <button className={showNew ? s.cancelBtn : s.newBtn} onClick={() => setShowNew((v) => !v)}>
          {showNew ? t('inventory.cancel') : t('inventory.newButton')}
        </button>
      </div>

      {/* New stock form */}
      {showNew && (
        <form onSubmit={create} className={s.newForm}>
          <input
            className={s.input}
            placeholder={t('inventory.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            required
          />
          <button type="submit" className={s.createBtn} disabled={creating}>
            {creating ? t('inventory.creating') : t('inventory.createButton')}
          </button>
        </form>
      )}

      {/* Expiring soon alert section */}
      {expiringStocks.length > 0 && (
        <div className={s.alertBox}>
          <div className={s.alertTitle}>⚠ {t('inventory.expiringSoon')}</div>
          {expiringStocks.map((st) => (
            <div key={st.id} className={s.alertProduct}>
              <div className={s.alertProductName}>{st.name}</div>
              {st.expiring_lots.map((lot) => (
                <div key={lot.id} className={s.alertLot}>
                  · {t('inventory.expiringLot', { qty: lot.quantity, date: formatExpiry(lot.expiry_date) })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {stocks.length === 0 && !showNew && <p className={shared.muted}>{t('inventory.empty')}</p>}

      {/* Product list */}
      {stocks.map((stock) => {
        const form = lotForm(stock.id)
        return (
          <div key={stock.id} className={s.productCard} data-testid="product-card">
            {/* Product header */}
            <div className={s.productHeader}>
              <div className={s.productMeta}>
                <span className={s.productName}>{stock.name}</span>
                <span className={s.productTotal}>
                  ({stock.quantity} {t('common.total')})
                </span>
              </div>
              <button
                className={s.deleteBtn}
                onClick={() => setConfirmRemove({ id: stock.id, name: stock.name })}
                title={t('inventory.deleteTooltip')}
              >
                ✕
              </button>
            </div>

            {/* Lot list */}
            {stock.lots.length > 0 && (
              <div className={s.lotList}>
                {stock.lots.map((lot) => {
                  const expiring = stock.expiring_lots.some((el) => el.id === lot.id)
                  return (
                    <div key={lot.id} className={s.lotRow}>
                      <div className={s.lotInfo}>
                        {lot.lot_number && <span className={s.lotNumber}>{lot.lot_number}</span>}
                        <span className={s.lotQty}>
                          {lot.quantity} {t('common.unit')}
                        </span>
                        <span className={cx(s.lotExpiry, expiring && s.lotExpiryDanger)}>
                          {lot.expiry_date ? formatExpiry(lot.expiry_date) : t('inventory.noExpiry')}
                          {expiring && ' ⚠'}
                        </span>
                      </div>
                      <button
                        className={s.lotDeleteBtn}
                        onClick={() => setConfirmRemoveLot({ stockId: stock.id, lotId: lot.id })}
                        title={t('inventory.deleteTooltip')}
                      >
                        🗑
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Add lot form */}
            {form.show ? (
              <form onSubmit={(e) => submitAddLot(e, stock.id)} className={s.addLotForm}>
                <div className={s.addLotRow}>
                  <div className={s.addLotField}>
                    <label className={s.fieldLabel}>{t('inventory.lotQty')} *</label>
                    <input
                      className={cx(s.input, s.inputNarrow)}
                      type="number"
                      min={0}
                      placeholder="0"
                      value={form.qty}
                      onChange={(e) => setLotField(stock.id, 'qty', e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div className={s.addLotField}>
                    <label className={s.fieldLabel}>{t('inventory.lotExpiry')}</label>
                    <input
                      className={s.input}
                      type="date"
                      value={form.expiry}
                      onChange={(e) => setLotField(stock.id, 'expiry', e.target.value)}
                    />
                  </div>
                  <div className={cx(s.addLotField, s.inputFlex)}>
                    <label className={s.fieldLabel}>{t('inventory.lotNumber')}</label>
                    <input
                      className={s.input}
                      type="text"
                      placeholder={t('inventory.lotNumber')}
                      value={form.lotNumber}
                      onChange={(e) => setLotField(stock.id, 'lotNumber', e.target.value)}
                    />
                  </div>
                </div>
                <div className={s.addLotActions}>
                  <button type="submit" className={s.createBtn} disabled={form.adding}>
                    {form.adding ? t('inventory.adding') : t('inventory.addLot')}
                  </button>
                  <button type="button" className={s.cancelBtn} onClick={() => toggleAddLot(stock.id)}>
                    {t('inventory.cancel')}
                  </button>
                </div>
              </form>
            ) : (
              <button className={s.addLotBtn} onClick={() => toggleAddLot(stock.id)}>
                + {t('inventory.addLot')}
              </button>
            )}
          </div>
        )
      })}

      {/* Confirm delete stock */}
      {confirmRemove && (
        <ConfirmModal
          message={t('inventory.confirmDelete', { name: confirmRemove.name })}
          onConfirm={doRemoveStock}
          onCancel={() => setConfirmRemove(null)}
          confirmLabel={t('inventory.deleteTooltip')}
        />
      )}

      {/* Confirm delete lot */}
      {confirmRemoveLot && (
        <ConfirmModal
          message={t('inventory.confirmDeleteLot')}
          onConfirm={doRemoveLot}
          onCancel={() => setConfirmRemoveLot(null)}
          confirmLabel={t('inventory.deleteTooltip')}
        />
      )}
    </div>
  )
}
