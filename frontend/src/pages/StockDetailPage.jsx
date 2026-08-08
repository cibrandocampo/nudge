import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AddLotForm from '../components/AddLotForm'
import ConfirmModal from '../components/ConfirmModal'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import QueryHandler from '../components/QueryHandler'
import SharedWithChips from '../components/SharedWithChips'
import LotPickerModal from '../components/LotPickerModal'
import StockLotsList from '../components/StockLotsList'
import StockValuesConfirmModal from '../components/StockValuesConfirmModal'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStock, useStockGroups } from '../hooks/useStock'
import { useStockConsumptions } from '../hooks/useEntries'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useDeleteStock } from '../hooks/mutations/useDeleteStock'
import { useDeleteStockLot } from '../hooks/mutations/useDeleteStockLot'
import { useUpdateStock } from '../hooks/mutations/useUpdateStock'
import { useAuth } from '../contexts/AuthContext'
import cx from '../utils/cx'
import { avatarInitial } from '../utils/displayName'
import { errorToastMessage } from '../utils/errors'
import { groupEntriesByDate } from '../utils/historyGroups'
import { effectiveGroupId } from '../utils/stockGroup'
import { reconcileStockFromLot } from '../utils/stockScanReconcile'
import { borderTokensFromStock } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import forms from '../styles/forms.module.css'
import layout from '../styles/layout.module.css'
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
  const updateStock = useUpdateStock()
  const reachable = useServerReachable()

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRemoveLot, setConfirmRemoveLot] = useState(null)
  // Set only when a save disagrees with the product's stored values; holds the
  // pending submission — and the form's unsettled promise — until the user decides.
  const [pendingReconcile, setPendingReconcile] = useState(null)
  // Single-unit consumption from the header card, handled by LotPickerModal.
  const [consumeOpen, setConsumeOpen] = useState(false)

  const tokens = borderTokensFromStock(stock)
  const groupName = stock ? groups.find((g) => g.id === effectiveGroupId(stock))?.name : undefined
  // Local-midnight today for lot expiry comparison; matches the backend's
  // `date.today()` semantics (a lot expiring today reads as 'reached'). Shared
  // with both children so an expired lot never reads differently in each.
  const today = new Date(new Date().toISOString().slice(0, 10))

  /**
   * Open the pack picker for a single unit. `LotPickerModal` owns the whole
   * flow from here — choosing the lot and, when that lot holds serialised
   * packs, which box — so this only has to refuse the impossible case.
   */
  const handleConsume = () => {
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    if (!stock?.lots?.length) {
      showToast({ type: 'error', message: t('common.actionError') })
      return
    }
    setConsumeOpen(true)
  }

  /**
   * Create the lot, then teach the product whatever this save established.
   *
   * The product update runs **after** the lot and never blocks it: they are two
   * separate offline-queue entries with different `resourceKey`s, so ordering
   * between them is not guaranteed and one can fail while the other succeeds.
   * The worst case of a lost update is that the next lot asks again.
   *
   * Throws on failure, after telling the user: `AddLotForm` reads the rejection
   * as "nothing was created" and keeps every typed value on screen.
   */
  const submitLot = async (payload, valuesToWrite) => {
    try {
      await createLot.mutateAsync({
        stockId,
        stockName: stock.name,
        quantity: payload.quantity,
        expiryDate: payload.expiryDate,
        lotNumber: payload.lotNumber,
        serialNumber: payload.serialNumber,
        // Sent whenever a scan produced this lot, serial or not. A code with no
        // AI 21 still carries the GTIN, which is the only place it comes from.
        rawScan: payload.rawScan,
      })
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
      throw err
    }
    if (Object.keys(valuesToWrite).length > 0) {
      updateStock
        .mutateAsync({
          stockId,
          stockName: stock.name,
          patch: valuesToWrite,
          updatedAt: stock?.updated_at,
        })
        .catch(() => {
          // Non-fatal by design: the lot is in, and the product simply has
          // not learned yet. Surfacing an error here would blame the user's
          // successful action for a background write.
        })
    }
  }

  /**
   * The form's submit contract. Resolving clears the form, rejecting keeps it —
   * so a save awaiting the reconciliation modal must not settle until the user
   * has answered it, which is why the promise is held open here.
   */
  const handleAddLot = async (payload) => {
    // Every write on a stock is owner-only (`IsOwner` in `StockViewSet`), so a
    // guest has nothing to reconcile — firing the update would be a guaranteed
    // 403 and, offline, a queued mutation that can never drain.
    if (!isOwner) return submitLot(payload, {})

    const { silent, discrepant } = reconcileStockFromLot({ stock, scan: payload.parsed, quantity: payload.quantity })
    if (discrepant.length === 0) return submitLot(payload, silent)

    // The quantity is only known now, at submit time, which is why the
    // question is asked here rather than when the code was scanned.
    return new Promise((resolve, reject) => {
      setPendingReconcile({ payload, silent, discrepant, resolve, reject })
    })
  }

  /**
   * Resolve the confirmation: `accept` adopts the disputed values too.
   * Either answer saves the lot — the question is which product values to
   * write, not whether to create it — and settles the form's pending promise.
   *
   * Only ever called from the two handlers rendered under `{pendingReconcile &&`,
   * whose closures therefore hold a non-null one — no nullish guard needed, and
   * one that could never fire would only suggest the invariant is weaker than
   * it is.
   */
  const resolveReconcile = async (accept) => {
    const pending = pendingReconcile
    setPendingReconcile(null)
    const extra = accept ? Object.fromEntries(pending.discrepant.map((d) => [d.field, d.next])) : {}
    try {
      await submitLot(pending.payload, { ...pending.silent, ...extra })
      pending.resolve()
    } catch (err) {
      pending.reject(err)
    }
  }

  const askRemoveLot = (lot) => {
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    setConfirmRemoveLot({ lotId: lot.id, updatedAt: lot.updated_at, serialNumber: lot.serial_number || null })
  }

  const doRemoveLot = async () => {
    const { lotId, updatedAt } = confirmRemoveLot
    setConfirmRemoveLot(null)
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    try {
      await deleteLot.mutateAsync({ stockId, stockName: stock.name, lotId, updatedAt })
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const doDeleteStock = async () => {
    setConfirmDelete(false)
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    try {
      await deleteStock.mutateAsync({ stockId, stockName: stock.name, updatedAt: stock.updated_at })
      navigate('/inventory')
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const isOwner = stock?.is_owner !== false
  const { user } = useAuth()

  // Recipients besides the current viewer. The owner sees every recipient;
  // a non-owner recipient sees every other recipient. Used by the
  // "Shared with" section so the label means the same thing on both sides.
  const otherStockRecipients = (stock?.shared_with_details ?? []).filter((c) => isOwner || c.id !== user?.id)

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
          <div className={cx(layout.topBar, s.topBarFlush)}>
            <Link to="/inventory" className={s.backLink} aria-label={t('common.backToInventory')}>
              <span>{t('common.backToInventory')}</span>
            </Link>
            <div className={s.topActions}>
              <Link
                to={`/history?type=consumptions&stock=${stockId}`}
                className={cx(buttons.btnAdd, buttons.btnAddSecondary)}
                aria-label={t('stockDetail.viewAll')}
                title={t('stockDetail.viewAll')}
              >
                <Icon name="history" />
              </Link>
              {isOwner && (
                <button
                  type="button"
                  className={cx(buttons.btnAdd, buttons.btnAddDanger, !reachable && buttons.disabled)}
                  onClick={() => {
                    if (!reachable) {
                      showToast({ type: 'error', message: t('offline.pageUnavailable') })
                      return
                    }
                    setConfirmDelete(true)
                  }}
                  aria-disabled={!reachable}
                  aria-label={t('stockDetail.deleteStock')}
                  title={!reachable ? t('offline.pageUnavailable') : t('stockDetail.deleteStock')}
                >
                  <Icon name="trash" />
                </button>
              )}
              <button
                type="button"
                className={cx(buttons.btnAdd, !reachable && buttons.disabled)}
                onClick={() => {
                  if (!reachable) {
                    showToast({ type: 'error', message: t('offline.pageUnavailable') })
                    return
                  }
                  navigate(`/inventory/${stockId}/edit`)
                }}
                aria-disabled={!reachable}
                aria-label={t('stockDetail.edit')}
                title={!reachable ? t('offline.pageUnavailable') : t('stockDetail.edit')}
              >
                <Icon name="pencil" />
              </button>
            </div>
          </div>

          <div className={cx(cards.card, tokens.border)}>
            <div className={cards.cardHeader}>
              <div className={cards.cardMeta}>
                <span className={cx(cards.cardTitle, cards.cardTitleFlex)}>
                  <span>{stock.name}</span>
                  <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
                </span>
                <span className={cards.cardSubtitle}>
                  <span className={cx(cards.dot, tokens.dot)} />
                  <span className={cards.stockQty}>
                    {stock.quantity_available ?? stock.quantity ?? 0} {t('common.total')}
                  </span>
                  {(stock.quantity_expired ?? 0) > 0 && (
                    <span className={cards.stockQtyExpired}>
                      ({t('inventory.expiredCount', { count: stock.quantity_expired })})
                    </span>
                  )}
                  {stock.estimated_depletion_date && (
                    <span
                      className={cx(
                        cards.stockDepletion,
                        stock.stock_severity === 'low' && cards.stockDepletionWarn,
                        stock.stock_severity === 'critical' && cards.stockDepletionDanger,
                      )}
                      data-testid="depletion-date"
                      title={stock.depletion_is_estimated ? t('inventory.depletionEstimatedAria') : undefined}
                    >
                      {stock.depletion_is_estimated && <Icon name="equal-approximately" size="sm" />}
                      {t('inventory.depletionUntil', { date: formatShortDate(stock.estimated_depletion_date) })}
                    </span>
                  )}
                </span>
              </div>
              {/* The category pill lives in the header row, not inside the
                  subtitle. `cardCategoryPill` pushes itself right with
                  `margin-left: auto`, which used to land it against the card
                  edge — but with the consume button there it ended up beside a
                  control it did not share a baseline with. As a sibling of the
                  button it inherits `cardHeader`'s vertical centring, so the
                  two line up. */}
              {groupName && (
                <span className={cards.cardCategoryPill}>
                  <Icon name="tag" size="sm" />
                  {groupName}
                </span>
              )}
              {/* Consume one unit, the most frequent action on a stock. It
                  lives on the card rather than in the top bar so it sits next
                  to the number it decrements, mirrors where `StockCard` puts
                  it in the inventory list, and stays away from the destructive
                  delete button. Hidden at zero: it could only fail. */}
              {(stock.quantity_available ?? stock.quantity ?? 0) > 0 && (
                <button
                  type="button"
                  className={cx(buttons.btnIcon, buttons.btnIconConsume, !reachable && buttons.disabled)}
                  onClick={handleConsume}
                  aria-disabled={!reachable}
                  aria-label={t('inventory.consumeTooltip')}
                  title={!reachable ? t('offline.pageUnavailable') : t('inventory.consumeTooltip')}
                  data-testid="consume-one"
                >
                  <Icon name="package" className={buttons.consumeBox} />
                  <Icon name="arrow-down" className={buttons.consumeArrow} />
                </button>
              )}
            </div>
          </div>

          {/* Non-owner viewer: single card with the owner chip on the left
              and (if any) the other recipients on the right. Mirrors
              RoutineDetailPage. */}
          {stock.is_owner === false && stock.owner_display_name && (
            <section className={cx(forms.formSection, s.sharedBlock)} data-testid="people-info">
              <div className={s.peopleSplit}>
                <div className={s.peopleColumn} data-testid="owner-info">
                  <span className={forms.formSectionTitle}>{t('sharing.owner')}</span>
                  <div className={forms.formChipsRow}>
                    <span className={forms.formChip}>
                      <span className={forms.formChipAvatar} aria-hidden="true">
                        {avatarInitial({ first_name: stock.owner_display_name })}
                      </span>
                      <span>{stock.owner_display_name}</span>
                    </span>
                  </div>
                </div>
                {otherStockRecipients.length > 0 && (
                  <div className={s.peopleColumn} data-testid="shared-with-info">
                    <span className={forms.formSectionTitle}>{t('sharing.sharedWith')}</span>
                    <SharedWithChips contacts={otherStockRecipients} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Owner viewer keeps the standalone "Shared with" card. */}
          {isOwner && otherStockRecipients.length > 0 && (
            <section className={cx(forms.formSection, s.sharedBlock)} data-testid="shared-with-info">
              <div className={forms.formSectionHeader}>
                <span className={forms.formSectionTitle}>{t('sharing.sharedWith')}</span>
              </div>
              <SharedWithChips contacts={otherStockRecipients} />
            </section>
          )}

          <section className={s.section}>
            <p className={layout.sectionTitle}>{t('stockDetail.lots')}</p>
            <div className={s.lotsCard}>
              <StockLotsList lots={stock.lots ?? []} today={today} reachable={reachable} onRemoveLot={askRemoveLot} />

              <AddLotForm stock={stock} today={today} onSubmit={handleAddLot} />
            </div>
          </section>

          {consumptions.length > 0 && (
            <section className={s.section}>
              <p className={layout.sectionTitle}>{t('stockDetail.recentConsumption')}</p>
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
              message={
                confirmRemoveLot.serialNumber
                  ? t('stockDetail.confirmDeletePack', { serial: confirmRemoveLot.serialNumber })
                  : t('inventory.confirmDeleteLot')
              }
              onConfirm={doRemoveLot}
              onCancel={() => setConfirmRemoveLot(null)}
              confirmLabel={t('inventory.deleteTooltip')}
            />
          )}

          {consumeOpen && (
            <LotPickerModal
              stock={stock}
              onClose={() => setConsumeOpen(false)}
              onConsumed={() => setConsumeOpen(false)}
            />
          )}

          {pendingReconcile && (
            <StockValuesConfirmModal
              discrepancies={pendingReconcile.discrepant}
              onConfirm={() => resolveReconcile(true)}
              onCancel={() => resolveReconcile(false)}
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
