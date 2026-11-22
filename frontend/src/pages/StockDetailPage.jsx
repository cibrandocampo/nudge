import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AddLotForm from '../components/AddLotForm'
import ConfirmModal from '../components/ConfirmModal'
import EditToggle from '../components/EditToggle'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import QueryHandler from '../components/QueryHandler'
import RegulatoryInfoSection from '../components/RegulatoryInfoSection'
import SharedWithChips from '../components/SharedWithChips'
import LotPickerModal from '../components/LotPickerModal'
import OverflowMenu from '../components/OverflowMenu'
import StockLotsList from '../components/StockLotsList'
import StockValuesConfirmModal from '../components/StockValuesConfirmModal'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useEditMode } from '../hooks/useEditMode'
import { useConsumeOne } from '../hooks/useConsumeOne'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStock, useStockGroups, useStockList } from '../hooks/useStock'
import { useStockConsumptions } from '../hooks/useEntries'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useDeleteStock } from '../hooks/mutations/useDeleteStock'
import { useDeleteStockLot } from '../hooks/mutations/useDeleteStockLot'
import { useToggleStockPin } from '../hooks/mutations/useToggleStockPin'
import { useAnswerNameOffer } from '../hooks/mutations/useAnswerNameOffer'
import { useUpdateStock } from '../hooks/mutations/useUpdateStock'
import { useAuth } from '../contexts/AuthContext'
import cx from '../utils/cx'
import { avatarInitial } from '../utils/displayName'
import { OfflineError } from '../api/errors'
import { errorToastMessage } from '../utils/errors'
import { groupEntriesByDate } from '../utils/historyGroups'
import { reconcileStockFromLot } from '../utils/stockScanReconcile'
import { stockRowReasons } from '../utils/stockAlerts'
import { borderTokensFromStock } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import forms from '../styles/forms.module.css'
import layout from '../styles/layout.module.css'
import s from './StockDetailPage.module.css'
import BackLink from '../components/BackLink'

export default function StockDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { showToast } = useToast()

  const stockId = Number(id)
  // Polls while the stock's regulatory data is being fetched (see `useStock`).
  const { data: stock, isLoading, isError, error } = useStock(stockId, { pollWhilePending: true })
  const { data: groups = [] } = useStockGroups()
  const { data: consumptions = [] } = useStockConsumptions({ stock: String(stockId), enabled: !isNaN(stockId) })
  const deleteStock = useDeleteStock()
  const createLot = useCreateStockLot()
  const deleteLot = useDeleteStockLot()
  const updateStock = useUpdateStock()
  const reachable = useServerReachable()
  // «Edit» mode of the lots list (T153); ends when the last lot goes.
  const lotsEdit = useEditMode({ count: (stock?.lots ?? []).length })

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRemoveLot, setConfirmRemoveLot] = useState(null)
  // Set only when a save disagrees with the product's stored values; holds the
  // pending submission — and the form's unsettled promise — until the user decides.
  const [pendingReconcile, setPendingReconcile] = useState(null)
  // The same flow as the inventory (T129). Queueable, so it also works offline.
  const { consumeOne, consumingId, pickerStock, closePicker, onPickerConsumed } = useConsumeOne()

  const tokens = borderTokensFromStock(stock)
  // The header's own reason line: the inventory row's reasons minus the
  // agency's, which the medicine section below already shows.
  const headerReasons = stockRowReasons(stock).filter((reason) => reason.kind !== 'regulatory')
  // In the user's order; an id not in the cache yet shows nothing rather than
  // an empty pill.
  const categories = groups.filter((group) => stock?.my_groups?.includes(group.id))
  // Local-midnight today for lot expiry comparison; matches the backend's
  // `date.today()` semantics (a lot expiring today reads as 'reached'). Shared
  // with both children so an expired lot never reads differently in each.
  const today = new Date(new Date().toISOString().slice(0, 10))

  // Not read here, on purpose: a product opened from the list is seeded from it
  // and never fetched on its own, so the service worker only holds the list.
  // Keeping it subscribed is what brings the product back on a reload with the
  // server down.
  useStockList()
  const isPinned = Boolean(stock?.is_pinned)
  const togglePin = useToggleStockPin()

  const handleTogglePin = async () => {
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    try {
      await togglePin.mutateAsync({ stockId, pinned: !isPinned })
    } catch (err) {
      // Live because this mutation is not queueable: offline it rejects
      // rather than enqueueing.
      if (err instanceof OfflineError) {
        showToast({ type: 'error', message: t('offline.pageUnavailable') })
      } else {
        showToast({ type: 'error', message: errorToastMessage(err, t) })
      }
    }
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

  // ── Official-name offer ──────────────────────────────────────────────────
  // The first time a stock gets a national code (and on "Refresh info") the
  // server raises `regulatory.name_offer_pending`; the owner is asked once
  // whether to adopt the agency's name. Only when the fetch is `ok` — before
  // that there is no official name — and only online, because the answer is
  // not queueable (see `useAnswerNameOffer`).
  const regulatory = stock?.regulatory
  // Closing the modal (X, Escape) answers nothing: the offer is hidden for this
  // visit and comes back on the next one. Keyed by stock and fetch, because the
  // route reuses this component across stocks and a new fetch is a new offer.
  const offerKey = regulatory ? `${stockId}:${regulatory.fetched_at}` : null
  const [dismissedOffer, setDismissedOffer] = useState(null)
  const answerNameOffer = useAnswerNameOffer()
  const autoAnsweredOffer = useRef(null)
  const nameOfferReady =
    isOwner &&
    Boolean(regulatory?.name_offer_pending) &&
    regulatory.fetch_status === 'ok' &&
    reachable &&
    dismissedOffer !== offerKey
  const sameOfficialName = nameOfferReady && regulatory.official_name === stock.name
  // Never stack two modals: a lot reconciliation, a consumption or a delete
  // confirmation in progress goes first, and the offer waits for it.
  const otherModalOpen = Boolean(pendingReconcile || pickerStock || confirmDelete || confirmRemoveLot)
  const showNameOffer = nameOfferReady && !sameOfficialName && !otherModalOpen

  // Nothing to ask when the names already match: clear the flag, once.
  useEffect(() => {
    if (!sameOfficialName || autoAnsweredOffer.current === offerKey) return
    autoAnsweredOffer.current = offerKey
    answerNameOffer.mutateAsync({ stockId, accept: false }).catch(() => {
      // Harmless: the flag stays and the same check runs on the next visit.
    })
  }, [sameOfficialName, offerKey, stockId, answerNameOffer])

  const answerOffer = async (accept) => {
    try {
      await answerNameOffer.mutateAsync({ stockId, accept })
    } catch (err) {
      // Not queueable, so a dropped connection rejects instead of enqueueing:
      // treat it as "not answered" and ask again on the next visit.
      setDismissedOffer(offerKey)
      if (!(err instanceof OfflineError)) showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

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
            <BackLink to="/inventory">{t('common.backToInventory')}</BackLink>
            {/* Rare actions in «More» (T152, UX-018/034); the frequent ones
                — consume, edit — are text buttons on the card below. */}
            <OverflowMenu
              items={[
                {
                  key: 'history',
                  label: t('menu.viewHistory'),
                  icon: 'history',
                  to: `/history?type=consumptions&stock=${stockId}`,
                  testId: 'menu-history',
                },
                ...(isOwner
                  ? [
                      {
                        key: 'delete',
                        label: t('stockDetail.deleteStock'),
                        icon: 'trash',
                        danger: true,
                        disabled: !reachable,
                        onDisabledSelect: () => showToast({ type: 'error', message: t('offline.pageUnavailable') }),
                        onSelect: () => setConfirmDelete(true),
                        testId: 'menu-delete',
                      },
                    ]
                  : []),
              ]}
            />
          </div>

          <div className={cx(cards.card, tokens.border)}>
            <div className={cx(cards.cardHeader, s.headerRow)}>
              <div className={cards.cardMeta}>
                <span className={cx(cards.cardTitle, cards.cardTitleFlex)}>
                  <span className={cards.clampName}>{stock.name}</span>
                  <SyncStatusBadge resourceKey={`stock:${stock.id}`} />
                </span>
                <span className={cards.cardSubtitle}>
                  <span className={cx(cards.dot, tokens.dot)} />
                  <span className={cx(cards.stockQty, s.headerQty)}>
                    {stock.quantity_available ?? stock.quantity ?? 0} {t('common.total')}
                  </span>
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
                {/* Why it needs attention, on a line of its own under the
                    total (as on the inventory row): expired units, low stock,
                    expiring soon. The agency's verdicts have their own section
                    below, so they are not repeated here. */}
                {headerReasons.length > 0 && (
                  <span className={s.headerReasons} data-testid="stock-reasons">
                    {headerReasons.map((reason) => (
                      <span
                        key={reason.key}
                        className={reason.tone === 'danger' ? s.reasonDanger : s.reasonWarning}
                        data-testid="stock-reason"
                        data-kind={reason.kind}
                      >
                        {t(reason.key, reason.params)}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className={s.headerActions}>
                {/* Pin to the top of the inventory. A per-user preference, so a
                  recipient of a shared stock gets it too — the endpoint is
                  not gated on ownership. */}
                <button
                  type="button"
                  className={cx(
                    buttons.icon,
                    isPinned ? s.pinOn : buttons.outlined,
                    !reachable && buttons.disabled,
                    isPinned && s.pinnedIcon,
                  )}
                  onClick={handleTogglePin}
                  aria-pressed={isPinned}
                  aria-disabled={!reachable}
                  aria-label={isPinned ? t('inventory.unpinAction') : t('inventory.pinAction')}
                  title={
                    !reachable
                      ? t('offline.pageUnavailable')
                      : isPinned
                        ? t('inventory.unpinAction')
                        : t('inventory.pinAction')
                  }
                  data-testid="pin-toggle"
                  data-pinned={isPinned}
                >
                  <Icon name="pin" size="sm" />
                </button>
              </div>
            </div>
            {categories.length > 0 && (
              <div className={s.categories} data-testid="stock-categories">
                {categories.map((group) => (
                  <span key={group.id} className={cx(cards.cardCategoryPill, s.categoryPill)}>
                    <Icon name="tag" size="sm" />
                    {group.name}
                  </span>
                ))}
              </div>
            )}
            {/* The two frequent actions, as text (T152, UX-018/034), on the
                card that shows the number they change and within the thumb's
                reach. «Consume 1» is the main one, hidden at zero units: it
                could only fail. */}
            <div className={s.cardActions}>
              {(stock.quantity_available ?? stock.quantity ?? 0) > 0 && (
                <button
                  type="button"
                  className={cx(buttons.btn, buttons.primary, s.consumeBtn, consumingId && buttons.disabled)}
                  onClick={() => consumeOne(stock)}
                  disabled={Boolean(consumingId)}
                  aria-label={t('inventory.consumeTooltip')}
                  data-testid="consume-one"
                >
                  <span className={buttons.consumeGlyph} aria-hidden="true">
                    <Icon name="package" className={buttons.consumeBox} />
                    <Icon name="arrow-down" className={buttons.consumeArrow} />
                  </span>
                  {t('inventory.consumeOne')}
                </button>
              )}
              <button
                type="button"
                className={cx(buttons.btn, buttons.secondary, s.editBtn, !reachable && buttons.disabled)}
                onClick={() => {
                  if (!reachable) {
                    showToast({ type: 'error', message: t('offline.pageUnavailable') })
                    return
                  }
                  navigate(`/inventory/${stockId}/edit`)
                }}
                aria-disabled={!reachable}
                title={!reachable ? t('offline.pageUnavailable') : undefined}
                data-testid="edit-stock"
              >
                <Icon name="pencil" size="sm" />
                {t('stockDetail.edit')}
              </button>
            </div>
          </div>

          {/* What the regulatory agency says about the medicine. Right under the
              header: a supply problem or a suspension matters more than who
              the stock is shared with. Only for a stock with a national code. */}
          {stock.regulatory && <RegulatoryInfoSection stock={stock} isOwner={isOwner} reachable={reachable} />}

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

          {/* The lots table lists what there is; adding a lot is an action of
              its own, so it sits below the table rather than inside it. With
              no lots there is no table, only the way to add one. */}
          {(stock.lots ?? []).length > 0 && (
            <section className={s.section}>
              {/* «Edit» reveals the delete buttons (T153, UX-036): at rest the
                  list shows no trash per row. */}
              <div className={s.sectionHeader}>
                <p className={layout.sectionTitle}>{t('stockDetail.lots')}</p>
                <EditToggle
                  section={t('stockDetail.lots')}
                  editing={lotsEdit.editing}
                  onToggle={lotsEdit.toggle}
                  controls="stock-lots"
                  reachable={reachable}
                  offlineTitle={t('offline.pageUnavailable')}
                  onOffline={() => showToast({ type: 'error', message: t('offline.pageUnavailable') })}
                />
              </div>
              <div className={s.lotsCard}>
                <StockLotsList
                  id="stock-lots"
                  lots={stock.lots}
                  today={today}
                  reachable={reachable}
                  editing={lotsEdit.editing}
                  onRemoveLot={askRemoveLot}
                />
              </div>
            </section>
          )}

          <section className={s.section}>
            <AddLotForm stock={stock} today={today} onSubmit={handleAddLot} />
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

          {pickerStock && <LotPickerModal stock={stock} onClose={closePicker} onConsumed={onPickerConsumed} />}

          {pendingReconcile && (
            <StockValuesConfirmModal
              discrepancies={pendingReconcile.discrepant}
              onConfirm={() => resolveReconcile(true)}
              onCancel={() => resolveReconcile(false)}
            />
          )}

          {showNameOffer && (
            <StockValuesConfirmModal
              discrepancies={[{ field: 'name', current: stock.name, next: regulatory.official_name }]}
              title="stockValues.nameOfferTitle"
              intro="stockValues.nameOfferIntro"
              introValues={{ source: regulatory.display_name }}
              busy={answerNameOffer.isPending}
              onConfirm={() => answerOffer(true)}
              onCancel={() => answerOffer(false)}
              onDismiss={() => setDismissedOffer(offerKey)}
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
