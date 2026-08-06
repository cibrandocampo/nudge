import { Fragment, Suspense, lazy, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../components/ConfirmModal'
import FormField from '../components/FormField'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import QueryHandler from '../components/QueryHandler'
import SharedWithChips from '../components/SharedWithChips'
import LotPickerModal from '../components/LotPickerModal'
import StockValuesConfirmModal from '../components/StockValuesConfirmModal'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useClickOutside } from '../hooks/useClickOutside'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useScannerAvailable } from '../hooks/useScannerAvailable'
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
import { parseGs1 } from '../utils/gs1'
import { groupEntriesByDate } from '../utils/historyGroups'
import { groupLots } from '../utils/lotsForSelection'
import { parseIntSafe } from '../utils/number'
import { effectiveGroupId } from '../utils/stockGroup'
import { reconcileStockFromLot } from '../utils/stockScanReconcile'
import { borderTokensFromStock, iconClassForLot, lotExpirySeverity } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './StockDetailPage.module.css'

// Dynamic: the decoder chunk and its ~1 MB WebAssembly binary must not be
// fetched by everyone who opens a stock, only by whoever taps the camera.
const BarcodeScannerModal = lazy(() => import('../components/BarcodeScannerModal'))

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
  const [addForm, setAddForm] = useState({ qty: '', expiry: '', lotNumber: '', adding: false })
  const [showAddLot, setShowAddLot] = useState(false)
  // Keys of the lot groups whose individual boxes are on screen. Purely local:
  // the expansion is a way to look inside a row, not state worth persisting.
  const [expandedGroups, setExpandedGroups] = useState([])
  // Scan state: what the barcode contributed to the form beyond the visible
  // fields, plus the reason (if any) the scanned pack cannot be added.
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanNotice, setScanNotice] = useState(null)
  const [scanned, setScanned] = useState({ serialNumber: null, rawScan: '', parsed: null })
  const [scanBlocker, setScanBlocker] = useState(null)
  // Set only when a save disagrees with the product's stored values; holds the
  // pending submission until the user decides.
  const [pendingReconcile, setPendingReconcile] = useState(null)
  // Single-unit consumption from the header card, handled by LotPickerModal.
  const [consumeOpen, setConsumeOpen] = useState(false)
  const scannerAvailable = useScannerAvailable()
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
  const groupName = stock ? groups.find((g) => g.id === effectiveGroupId(stock))?.name : undefined
  // Local-midnight today for lot expiry comparison; matches the backend's
  // `date.today()` semantics (a lot expiring today reads as 'reached').
  const today = new Date(new Date().toISOString().slice(0, 10))

  // The product's learned default, as a form value. Adding a second lot in a
  // row must start from the same place as the first, so `resetAddForm` restores
  // it rather than blanking the field.
  const defaultQty = stock?.default_lot_quantity ? String(stock.default_lot_quantity) : ''
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

  const resetAddForm = () => {
    setAddForm({ qty: defaultQty, expiry: '', lotNumber: '', adding: false })
    setScanned({ serialNumber: null, rawScan: '', parsed: null })
    setScanBlocker(null)
  }

  /**
   * A successful camera read. Returning `false` rejects it and leaves the
   * scanner running — the user is still pointing at the box.
   */
  const handleDecoded = (raw) => {
    const parsed = parseGs1(raw)
    if (!parsed || (!parsed.lotNumber && !parsed.expiryDate && !parsed.serialNumber)) {
      setScanNotice(t('scan.errorUnrecognised'))
      return false
    }

    // A scan fills what the code carries and leaves the rest of the form as the
    // user typed it — a partial payload must never blank a field. The quantity
    // falls back to one box only when the product has no learned default:
    // otherwise a scan would overwrite the user's own preference on every read.
    setAddForm((f) => ({
      ...f,
      qty: defaultQty || '1',
      expiry: parsed.expiryDate ?? f.expiry,
      lotNumber: parsed.lotNumber ?? f.lotNumber,
    }))
    setScanned({ serialNumber: parsed.serialNumber, rawScan: raw, parsed })
    setScanNotice(null)

    // Both checks mirror a rule the server enforces anyway; running them here
    // turns a raw 400 into an explanation, and works offline from cache.
    if (parsed.expiryDate && new Date(parsed.expiryDate) < today) {
      setScanBlocker({ key: 'scan.errorExpired', args: { date: formatShortDate(parsed.expiryDate) } })
    } else if (parsed.serialNumber && (stock?.lots ?? []).some((l) => l.serial_number === parsed.serialNumber)) {
      setScanBlocker({ key: 'scan.errorDuplicate', args: {} })
    } else {
      setScanBlocker(null)
    }
    return true
  }

  const clearScannedSerial = () => {
    setScanned((prev) => ({ ...prev, serialNumber: null }))
    setScanBlocker((prev) => (prev?.key === 'scan.errorDuplicate' ? null : prev))
  }

  /**
   * Create the lot, then teach the product whatever this save established.
   *
   * The product update runs **after** the lot and never blocks it: they are two
   * separate offline-queue entries with different `resourceKey`s, so ordering
   * between them is not guaranteed and one can fail while the other succeeds.
   * The worst case of a lost update is that the next lot asks again.
   */
  const submitLot = async (qty, valuesToWrite) => {
    setAddForm((f) => ({ ...f, adding: true }))
    try {
      await createLot.mutateAsync({
        stockId,
        stockName: stock.name,
        quantity: qty,
        expiryDate: addForm.expiry,
        lotNumber: addForm.lotNumber.trim(),
        serialNumber: scanned.serialNumber ?? '',
        // Sent whenever a scan produced this lot, serial or not. A code with no
        // AI 21 still carries the GTIN, which is the only place it comes from.
        rawScan: scanned.rawScan,
      })
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
      resetAddForm()
      setShowAddLot(false)
    } catch (err) {
      setAddForm((f) => ({ ...f, adding: false }))
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  const handleAddLot = async (e) => {
    e.preventDefault()
    if (scanBlocker) return
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    const qty = parseIntSafe(addForm.qty, -1)
    if (qty < 0) return

    // Every write on a stock is owner-only (`IsOwner` in `StockViewSet`), so a
    // guest has nothing to reconcile — firing the update would be a guaranteed
    // 403 and, offline, a queued mutation that can never drain.
    if (!isOwner) {
      await submitLot(qty, {})
      return
    }

    const { silent, discrepant } = reconcileStockFromLot({ stock, scan: scanned.parsed, quantity: qty })
    if (discrepant.length > 0) {
      // The quantity is only known now, at submit time, which is why the
      // question is asked here rather than when the code was scanned.
      setPendingReconcile({ qty, silent, discrepant })
      return
    }
    await submitLot(qty, silent)
  }

  /** Resolve the confirmation: `accept` adopts the disputed values too. */
  const resolveReconcile = async (accept) => {
    const pending = pendingReconcile
    setPendingReconcile(null)
    if (!pending) return
    const extra = accept ? Object.fromEntries(pending.discrepant.map((d) => [d.field, d.next])) : {}
    await submitLot(pending.qty, { ...pending.silent, ...extra })
  }

  // `minQuantity: 0` — the detail list shows exactly what the server sent,
  // where the consumption modals only offer lots with units left.
  const lotGroups = groupLots(stock?.lots ?? [], { minQuantity: 0 })

  const toggleGroup = (key) =>
    setExpandedGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

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
          <div className={cx(shared.topBar, s.topBarFlush)}>
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
                  className={cx(shared.btnAdd, shared.btnAddDanger, !reachable && shared.disabled)}
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
                className={cx(shared.btnAdd, !reachable && shared.disabled)}
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
                <span className={shared.cardCategoryPill}>
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
                  className={cx(shared.btnIcon, shared.btnIconConsume, !reachable && shared.disabled)}
                  onClick={handleConsume}
                  aria-disabled={!reachable}
                  aria-label={t('inventory.consumeTooltip')}
                  title={!reachable ? t('offline.pageUnavailable') : t('inventory.consumeTooltip')}
                  data-testid="consume-one"
                >
                  <Icon name="package" className={shared.consumeBox} />
                  <Icon name="arrow-down" className={shared.consumeArrow} />
                </button>
              )}
            </div>
          </div>

          {/* Non-owner viewer: single card with the owner chip on the left
              and (if any) the other recipients on the right. Mirrors
              RoutineDetailPage. */}
          {stock.is_owner === false && stock.owner_display_name && (
            <section className={cx(shared.formSection, s.sharedBlock)} data-testid="people-info">
              <div className={s.peopleSplit}>
                <div className={s.peopleColumn} data-testid="owner-info">
                  <span className={shared.formSectionTitle}>{t('sharing.owner')}</span>
                  <div className={shared.formChipsRow}>
                    <span className={shared.formChip}>
                      <span className={shared.formChipAvatar} aria-hidden="true">
                        {avatarInitial({ first_name: stock.owner_display_name })}
                      </span>
                      <span>{stock.owner_display_name}</span>
                    </span>
                  </div>
                </div>
                {otherStockRecipients.length > 0 && (
                  <div className={s.peopleColumn} data-testid="shared-with-info">
                    <span className={shared.formSectionTitle}>{t('sharing.sharedWith')}</span>
                    <SharedWithChips contacts={otherStockRecipients} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Owner viewer keeps the standalone "Shared with" card. */}
          {isOwner && otherStockRecipients.length > 0 && (
            <section className={cx(shared.formSection, s.sharedBlock)} data-testid="shared-with-info">
              <div className={shared.formSectionHeader}>
                <span className={shared.formSectionTitle}>{t('sharing.sharedWith')}</span>
              </div>
              <SharedWithChips contacts={otherStockRecipients} />
            </section>
          )}

          <section className={s.section}>
            <p className={shared.sectionTitle}>{t('stockDetail.lots')}</p>
            <div className={s.lotsCard}>
              {lotGroups.length > 0 && (
                <div className={s.lotsList} data-with-pills={stock.lots.some((l) => l.lot_number) || undefined}>
                  {lotGroups.map((group) => {
                    const sev = lotExpirySeverity(group, today)
                    // Several rows sharing lot number and expiry are several
                    // physical boxes: the group collapses them and expands to
                    // show each one by its serial.
                    const isSplit = group.rows.length > 1
                    const expanded = expandedGroups.includes(group.key)
                    return (
                      <Fragment key={group.key}>
                        <div className={shared.cardLotRow} data-testid="lot-row" data-expiring={sev}>
                          <div className={shared.cardLotMain}>
                            <Icon
                              name="package"
                              size="sm"
                              className={cx(shared.cardLotIcon, iconClassForLot(group, today))}
                            />
                            <span className={cx(shared.cardLotQty, sev === 'reached' && shared.cardLotQtyExpired)}>
                              {group.quantity} {t('common.unit')}
                            </span>
                          </div>
                          <div className={shared.cardLotMeta}>
                            {/* Date and pill render in fixed grid columns (s.lotsList is
                                a 4-col grid; cardLotMeta has display:contents, so these
                                spans land directly in the parent grid). */}
                            {group.expiry_date && (
                              <span className={cx(shared.cardLotExpiry, iconClassForLot(group, today))}>
                                {t('inventory.lotExpiryDate', {
                                  date: formatShortDate(group.expiry_date),
                                })}
                              </span>
                            )}
                            {group.lot_number && <span className={shared.cardLotNumberPill}>{group.lot_number}</span>}
                          </div>
                          {isSplit ? (
                            <button
                              type="button"
                              className={cx(shared.btnIcon, s.lotDeleteBtn, s.groupExpander)}
                              onClick={() => toggleGroup(group.key)}
                              aria-expanded={expanded}
                              aria-label={t('stockDetail.togglePacks')}
                              title={t('stockDetail.togglePacks')}
                              data-testid="group-expander"
                            >
                              {/* The bare count replaces a "· N packs" caption in the
                                  lot pill: on a phone that caption pushed the row into
                                  two lines, and the chevron already says "expandable". */}
                              <span className={s.packCount}>{group.rows.length}</span>
                              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={cx(
                                shared.btnIcon,
                                shared.btnIconDelete,
                                s.lotDeleteBtn,
                                !reachable && shared.disabled,
                              )}
                              onClick={() => askRemoveLot(group.rows[0])}
                              aria-disabled={!reachable}
                              aria-label={t('inventory.deleteTooltip')}
                              title={!reachable ? t('offline.pageUnavailable') : t('inventory.deleteTooltip')}
                            >
                              <Icon name="trash" size="sm" />
                            </button>
                          )}
                        </div>
                        {isSplit &&
                          expanded &&
                          group.rows.map((lot) => (
                            <div
                              key={lot.id}
                              className={cx(shared.cardLotRow, s.packRow)}
                              data-testid="pack-row"
                              data-lot-id={lot.id}
                            >
                              <div className={shared.cardLotMain}>
                                <span className={shared.cardLotQty}>
                                  {lot.quantity} {t('common.unit')}
                                </span>
                              </div>
                              <div className={shared.cardLotMeta}>
                                {/* No "Serial" prefix here: every row in an
                                    expanded group is one physical pack, so the
                                    word only repeats what the list already
                                    says. The modals keep it — there the packs
                                    are mixed in with other choices. */}
                                <span className={cx(s.packSerial, lot.serial_number && s.packSerialCode)}>
                                  {lot.serial_number || t('lot.modal.unidentifiedUnits')}
                                </span>
                              </div>
                              <button
                                type="button"
                                className={cx(
                                  shared.btnIcon,
                                  shared.btnIconDelete,
                                  s.lotDeleteBtn,
                                  !reachable && shared.disabled,
                                )}
                                onClick={() => askRemoveLot(lot)}
                                aria-disabled={!reachable}
                                aria-label={t('inventory.deleteTooltip')}
                                title={!reachable ? t('offline.pageUnavailable') : t('inventory.deleteTooltip')}
                              >
                                <Icon name="trash" size="sm" />
                              </button>
                            </div>
                          ))}
                      </Fragment>
                    )
                  })}
                </div>
              )}

              {showAddLot ? (
                <form onSubmit={handleAddLot} className={s.addLotForm}>
                  {scannerAvailable && (
                    <button
                      type="button"
                      className={cx(shared.btn, shared.btnSecondary, s.scanBtn)}
                      onClick={() => {
                        setScanNotice(null)
                        setScannerOpen(true)
                      }}
                      data-testid="scan-lot"
                    >
                      <Icon name="scan-line" size="sm" />
                      {t('scan.button')}
                    </button>
                  )}
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

                  {scanned.serialNumber && (
                    <div className={s.serialChip} data-testid="serial-chip">
                      <span className={s.serialLabel}>{t('inventory.lotSerial')}</span>
                      <span className={s.serialValue}>{scanned.serialNumber}</span>
                      <button
                        type="button"
                        className={s.serialClear}
                        onClick={clearScannedSerial}
                        aria-label={t('common.clear')}
                        data-testid="serial-clear"
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </div>
                  )}

                  {scanBlocker && (
                    <p className={shared.error} data-testid="scan-blocker">
                      {t(scanBlocker.key, scanBlocker.args)}
                    </p>
                  )}

                  <div className={s.addLotActions}>
                    <button
                      type="button"
                      className={cx(shared.btn, shared.btnSecondary)}
                      onClick={() => {
                        resetAddForm()
                        setShowAddLot(false)
                      }}
                      disabled={addForm.adding}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="submit"
                      className={cx(shared.btn, shared.btnPrimary)}
                      disabled={addForm.adding || Boolean(scanBlocker)}
                    >
                      {addForm.adding ? t('inventory.adding') : t('inventory.addLot')}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className={cx(s.addLotToggle, !reachable && shared.disabled)}
                  onClick={() => {
                    if (!reachable) {
                      showToast({ type: 'error', message: t('offline.pageUnavailable') })
                      return
                    }
                    // Start from the product's learned default, so the common
                    // case is confirming a number rather than typing one.
                    setAddForm((f) => ({ ...f, qty: defaultQty }))
                    setShowAddLot(true)
                  }}
                  aria-disabled={!reachable}
                  title={!reachable ? t('offline.pageUnavailable') : undefined}
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

          {scannerOpen && (
            <Suspense fallback={null}>
              <BarcodeScannerModal
                onDecoded={handleDecoded}
                onClose={() => setScannerOpen(false)}
                notice={scanNotice}
              />
            </Suspense>
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
