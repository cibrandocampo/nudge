import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../components/ConfirmModal'
import FormField from '../components/FormField'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import QueryHandler from '../components/QueryHandler'
import SharedWithChips from '../components/SharedWithChips'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useClickOutside } from '../hooks/useClickOutside'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStock, useStockGroups } from '../hooks/useStock'
import { useStockConsumptions } from '../hooks/useEntries'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useDeleteStock } from '../hooks/mutations/useDeleteStock'
import { useDeleteStockLot } from '../hooks/mutations/useDeleteStockLot'
import { useAuth } from '../contexts/AuthContext'
import cx from '../utils/cx'
import { avatarInitial } from '../utils/displayName'
import { errorToastMessage } from '../utils/errors'
import { groupEntriesByDate } from '../utils/historyGroups'
import { parseIntSafe } from '../utils/number'
import { borderTokensFromStock, iconClassForLot, lotExpirySeverity } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './StockDetailPage.module.css'

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
  const [showAddLot, setShowAddLot] = useState(false)
  // Custom suggestion dropdown for the lot-number input. Replaces the
  // native `<datalist>`, whose popup placement is unreliable on mobile
  // (Android Chrome routes it into the keyboard autofill strip instead
  // of anchoring it below the input).
  const [lotSuggestOpen, setLotSuggestOpen] = useState(false)
  const lotSuggestRef = useRef(null)
  useClickOutside(lotSuggestRef, () => setLotSuggestOpen(false), lotSuggestOpen)
  useEscapeKey(() => setLotSuggestOpen(false), lotSuggestOpen)
  const lotSuggestions = Array.from(
    new Set((stock?.lots || []).map((l) => l.lot_number).filter((n) => n && n.trim().length > 0)),
  )
  const lotSuggestQuery = addForm.lotNumber.trim().toLowerCase()
  const filteredLotSuggestions = lotSuggestQuery
    ? lotSuggestions.filter((n) => n.toLowerCase().includes(lotSuggestQuery))
    : lotSuggestions

  const tokens = borderTokensFromStock(stock)
  const groupName = stock ? groups.find((g) => g.id === stock.group)?.name : undefined
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
      setShowAddLot(false)
    } catch (err) {
      setAddForm((f) => ({ ...f, adding: false }))
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const doRemoveLot = async () => {
    const { lotId, updatedAt } = confirmRemoveLot
    setConfirmRemoveLot(null)
    try {
      await deleteLot.mutateAsync({ stockId, stockName: stock.name, lotId, updatedAt })
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const doDeleteStock = async () => {
    setConfirmDelete(false)
    try {
      await deleteStock.mutateAsync({ stockId, stockName: stock.name, updatedAt: stock.updated_at })
      navigate('/inventory')
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const isOwner = stock?.is_owner !== false
  const { user } = useAuth()

  return (
    <QueryHandler
      isLoading={isLoading}
      isError={isError}
      error={error}
      data={stock}
      notFound={!isLoading && !isError && !stock}
      notFoundKey="stockDetail.notFound"
    >
      {stock && (
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
                <button
                  type="button"
                  className={cx(shared.btnAdd, shared.btnAddDanger)}
                  onClick={() => setConfirmDelete(true)}
                  aria-label={t('stockDetail.deleteStock')}
                  title={t('stockDetail.deleteStock')}
                >
                  <Icon name="trash" />
                </button>
              )}
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
                    {stock.quantity_available ?? stock.quantity ?? 0} {t('common.total')}
                  </span>
                  {(stock.quantity_expired ?? 0) > 0 && (
                    <span className={shared.stockQtyExpired}>
                      ({t('inventory.expiredCount', { count: stock.quantity_expired })})
                    </span>
                  )}
                  {stock.estimated_depletion_date && (
                    <span
                      className={cx(
                        shared.stockDepletion,
                        stock.stock_severity === 'low' && shared.stockDepletionWarn,
                        stock.stock_severity === 'critical' && shared.stockDepletionDanger,
                      )}
                      data-testid="depletion-date"
                      title={stock.depletion_is_estimated ? t('inventory.depletionEstimatedAria') : undefined}
                    >
                      {stock.depletion_is_estimated && <Icon name="equal-approximately" size="sm" />}
                      {t('inventory.depletionUntil', { date: formatShortDate(stock.estimated_depletion_date) })}
                    </span>
                  )}
                  {groupName && (
                    <span className={shared.cardCategoryPill}>
                      <Icon name="tag" size="sm" />
                      {groupName}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {stock.is_owner === false && stock.owner_username && (
            <section className={cx(shared.formSection, s.sharedBlock)} data-testid="owner-info">
              <div className={shared.formSectionHeader}>
                <span className={shared.formSectionTitle}>{t('sharing.owner')}</span>
              </div>
              <div className={shared.formChipsRow}>
                <span className={shared.formChip}>
                  <span className={shared.formChipAvatar} aria-hidden="true">
                    {avatarInitial({ username: stock.owner_username })}
                  </span>
                  <span>{stock.owner_username}</span>
                </span>
                {stock.shared_with_details
                  ?.filter((c) => c.username !== user?.username)
                  .map((c) => (
                    <span key={c.id} className={shared.formChip}>
                      <span className={shared.formChipAvatar} aria-hidden="true">
                        {avatarInitial(c)}
                      </span>
                      <span>{c.username}</span>
                    </span>
                  ))}
              </div>
            </section>
          )}

          {stock.is_owner !== false && stock.shared_with_details?.length > 0 && (
            <section className={cx(shared.formSection, s.sharedBlock)} data-testid="shared-with-info">
              <div className={shared.formSectionHeader}>
                <span className={shared.formSectionTitle}>{t('sharing.sharedWith')}</span>
              </div>
              <SharedWithChips contacts={stock.shared_with_details} />
            </section>
          )}

          <section className={s.section}>
            <p className={shared.sectionTitle}>{t('stockDetail.lots')}</p>
            <div className={s.lotsCard}>
              {stock.lots.length > 0 && (
                <div className={s.lotsList} data-with-pills={stock.lots.some((l) => l.lot_number) || undefined}>
                  {stock.lots.map((lot) => {
                    const sev = lotExpirySeverity(lot, today)
                    return (
                      <div
                        key={lot.id}
                        className={shared.cardLotRow}
                        data-testid="lot-row"
                        data-expiring={sev}
                      >
                        <div className={shared.cardLotMain}>
                          <Icon name="package" size="sm" className={cx(shared.cardLotIcon, iconClassForLot(lot, today))} />
                          <span className={cx(shared.cardLotQty, sev === 'reached' && shared.cardLotQtyExpired)}>
                            {lot.quantity} {t('common.unit')}
                          </span>
                        </div>
                        <div className={shared.cardLotMeta}>
                          {/* Date and pill render in fixed grid columns (s.lotsList is
                              a 4-col grid; cardLotMeta has display:contents, so these
                              spans land directly in the parent grid). */}
                          {lot.expiry_date && (
                            <span className={cx(shared.cardLotExpiry, iconClassForLot(lot, today))}>
                              {t('inventory.lotExpiryDate', {
                                date: formatShortDate(lot.expiry_date),
                              })}
                            </span>
                          )}
                          {lot.lot_number && <span className={shared.cardLotNumberPill}>{lot.lot_number}</span>}
                        </div>
                        <button
                          type="button"
                          className={cx(shared.btnIcon, shared.btnIconDelete, s.lotDeleteBtn)}
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

              {showAddLot ? (
                <form onSubmit={handleAddLot} className={s.addLotForm}>
                  <div className={s.addLotRow}>
                    <FormField label={`${t('inventory.lotQty')} *`}>
                      <input
                        className={cx(shared.input, s.addLotInput)}
                        type="number"
                        min={0}
                        placeholder="0"
                        value={addForm.qty}
                        onChange={(e) => setAddForm((f) => ({ ...f, qty: e.target.value }))}
                        required
                      />
                    </FormField>
                    <FormField label={t('inventory.lotExpiry')}>
                      <input
                        className={cx(shared.input, s.addLotInput)}
                        type="date"
                        value={addForm.expiry}
                        onChange={(e) => setAddForm((f) => ({ ...f, expiry: e.target.value }))}
                      />
                    </FormField>
                    <FormField label={t('inventory.lotNumber')}>
                      <div className={s.lotSuggestWrap} ref={lotSuggestRef}>
                        <input
                          className={cx(shared.input, s.addLotInput)}
                          type="text"
                          autoComplete="off"
                          placeholder={t('inventory.lotNumber')}
                          value={addForm.lotNumber}
                          onChange={(e) => {
                            setAddForm((f) => ({ ...f, lotNumber: e.target.value }))
                            setLotSuggestOpen(true)
                          }}
                          onFocus={() => setLotSuggestOpen(true)}
                        />
                        {lotSuggestOpen && filteredLotSuggestions.length > 0 && (
                          <ul className={s.lotSuggestList} role="listbox">
                            {filteredLotSuggestions.map((n) => (
                              <li
                                key={n}
                                role="option"
                                aria-selected={n === addForm.lotNumber}
                                className={s.lotSuggestItem}
                                onMouseDown={(e) => {
                                  // mousedown fires before the input loses focus,
                                  // so the click registers before any blur logic.
                                  e.preventDefault()
                                  setAddForm((f) => ({ ...f, lotNumber: n }))
                                  setLotSuggestOpen(false)
                                }}
                              >
                                {n}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </FormField>
                  </div>
                  <div className={s.addLotActions}>
                    <button
                      type="button"
                      className={cx(shared.btn, shared.btnSecondary)}
                      onClick={() => {
                        setAddForm({ qty: '', expiry: '', lotNumber: '', adding: false })
                        setShowAddLot(false)
                      }}
                      disabled={addForm.adding}
                    >
                      {t('common.cancel')}
                    </button>
                    <button type="submit" className={cx(shared.btn, shared.btnPrimary)} disabled={addForm.adding}>
                      {addForm.adding ? t('inventory.adding') : t('inventory.addLot')}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className={s.addLotToggle}
                  onClick={() => setShowAddLot(true)}
                  data-testid="add-lot-toggle"
                >
                  <Icon name="plus" size="sm" />
                  <span>{t('inventory.addLot')}</span>
                </button>
              )}
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
      )}
    </QueryHandler>
  )
}
