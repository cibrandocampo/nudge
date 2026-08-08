import { Suspense, lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Combobox from './Combobox'
import FormField from './FormField'
import Icon from './Icon'
import { useToast } from './useToast'
import { useScannerAvailable } from '../hooks/useScannerAvailable'
import { useServerReachable } from '../hooks/useServerReachable'
import cx from '../utils/cx'
import { parseGs1 } from '../utils/gs1'
import { parseIntSafe } from '../utils/number'
import { formatShortDate } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './AddLotForm.module.css'

// Dynamic: the decoder chunk and its ~1 MB WebAssembly binary must not be
// fetched by everyone who opens a stock, only by whoever taps the camera.
const BarcodeScannerModal = lazy(() => import('./BarcodeScannerModal'))

/**
 * The add-lot form of the stock detail: collapsed to a single "Add lot" button
 * until opened, then quantity, expiry and lot number, optionally filled by
 * scanning the box.
 *
 * The component owns **input state and validation** — the fields, the scanner,
 * the scan blockers, the lot-number suggestions and whether the form is open.
 * It owns no mutation: `onSubmit` receives the payload and returns a promise,
 * and **that promise decides what happens next**:
 *
 *   - resolves → the lot is in (or queued offline). The form clears itself and
 *     collapses back to its button.
 *   - rejects  → nothing was created. Every typed value stays exactly where it
 *     is, so the user can fix one field instead of retyping four.
 *
 * That contract is what keeps the caller's business — mutations, offline
 * queueing, the product-values reconciliation modal — out of here, and keeps
 * scan blockers out of the caller.
 *
 * Props:
 *   stock      — the product this lot belongs to; supplies `lots` (for the
 *                suggestions and the duplicate-serial check) and
 *                `default_lot_quantity`
 *   today      — local-midnight date, shared with the page so an expired scan
 *                and an expired lot row can never disagree across midnight
 *   onSubmit   — `(payload) => Promise`, see above. Payload carries
 *                `{ quantity, expiryDate, lotNumber, serialNumber, rawScan, parsed }`
 *
 * Reachability is read here rather than received: the form re-renders on its
 * own field state, so a prop would only be as fresh as the parent's last
 * render, and "can I still reach the server" is decided at submit time.
 * `useServerReachable` is a `useSyncExternalStore` hook — every consumer sees
 * the same value and re-renders when it changes.
 */
export default function AddLotForm({ stock, today, onSubmit }) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const reachable = useServerReachable()

  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState({ qty: '', expiry: '', lotNumber: '' })
  const [adding, setAdding] = useState(false)
  // Scan state: what the barcode contributed to the form beyond the visible
  // fields, plus the reason (if any) the scanned pack cannot be added.
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanNotice, setScanNotice] = useState(null)
  const [scanned, setScanned] = useState({ serialNumber: null, rawScan: '', parsed: null })
  const [scanBlocker, setScanBlocker] = useState(null)
  const scannerAvailable = useScannerAvailable()
  // The batch numbers this product already has, offered as suggestions.
  // Filtering, keyboard navigation and dismissal belong to `Combobox`.
  const lotSuggestions = Array.from(
    new Set((stock?.lots || []).map((l) => l.lot_number).filter((n) => n && n.trim().length > 0)),
  )

  // The product's learned default, as a form value. Adding a second lot in a
  // row must start from the same place as the first, so `resetForm` restores
  // it rather than blanking the field.
  const defaultQty = stock?.default_lot_quantity ? String(stock.default_lot_quantity) : ''

  const resetForm = () => {
    setFields({ qty: defaultQty, expiry: '', lotNumber: '' })
    setScanned({ serialNumber: null, rawScan: '', parsed: null })
    setScanBlocker(null)
  }

  const close = () => {
    resetForm()
    setOpen(false)
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
    setFields((f) => ({
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (scanBlocker) return
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    const quantity = parseIntSafe(fields.qty, -1)
    if (quantity < 0) return

    setAdding(true)
    try {
      await onSubmit({
        quantity,
        expiryDate: fields.expiry,
        lotNumber: fields.lotNumber.trim(),
        serialNumber: scanned.serialNumber ?? '',
        // Sent whenever a scan produced this lot, serial or not. A code with no
        // AI 21 still carries the GTIN, which is the only place it comes from.
        rawScan: scanned.rawScan,
        // Scan output, not a form field: the caller reconciles the product's
        // stored values against it.
        parsed: scanned.parsed,
      })
      setAdding(false)
      close()
    } catch {
      // The caller already told the user what went wrong. All this has to do is
      // hand the form back with everything still in it.
      setAdding(false)
    }
  }

  if (!open) {
    return (
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
          setFields((f) => ({ ...f, qty: defaultQty }))
          setOpen(true)
        }}
        aria-disabled={!reachable}
        title={!reachable ? t('offline.pageUnavailable') : undefined}
        data-testid="add-lot-toggle"
      >
        <Icon name="plus" size="sm" />
        <span>{t('inventory.addLot')}</span>
      </button>
    )
  }

  return (
    <>
      <form onSubmit={handleSubmit} className={s.addLotForm}>
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
              value={fields.qty}
              onChange={(e) => setFields((f) => ({ ...f, qty: e.target.value }))}
              required
            />
          </FormField>
          <FormField label={t('inventory.lotExpiry')}>
            <input
              className={cx(shared.input, s.addLotInput)}
              type="date"
              value={fields.expiry}
              onChange={(e) => setFields((f) => ({ ...f, expiry: e.target.value }))}
            />
          </FormField>
          <FormField label={t('inventory.lotNumber')}>
            {/* Free text with suggestions: a batch this product has never seen
                must be typeable, and the list is only a shortcut for the ones
                it has. `Combobox` brings the keyboard navigation and the
                `aria-activedescendant` the hand-rolled dropdown never had. */}
            <Combobox
              allowFreeText
              value={fields.lotNumber}
              onChange={(next) => setFields((f) => ({ ...f, lotNumber: next }))}
              options={lotSuggestions}
              placeholder={t('inventory.lotNumber')}
              inputClassName={s.addLotInput}
            />
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
          <button type="button" className={cx(shared.btn, shared.btnSecondary)} onClick={close} disabled={adding}>
            {t('common.cancel')}
          </button>
          <button type="submit" className={cx(shared.btn, shared.btnPrimary)} disabled={adding || Boolean(scanBlocker)}>
            {adding ? t('inventory.adding') : t('inventory.addLot')}
          </button>
        </div>
      </form>

      {scannerOpen && (
        <Suspense fallback={null}>
          <BarcodeScannerModal onDecoded={handleDecoded} onClose={() => setScannerOpen(false)} notice={scanNotice} />
        </Suspense>
      )}
    </>
  )
}
