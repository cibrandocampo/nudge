import { Suspense, lazy, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Combobox from './Combobox'
import FormField from './FormField'
import Icon from './Icon'
import { useToast } from './useToast'
import { useFieldDisclosure } from '../hooks/useFieldDisclosure'
import { useScannerAvailable } from '../hooks/useScannerAvailable'
import { useServerReachable } from '../hooks/useServerReachable'
import cx from '../utils/cx'
import { parseGs1 } from '../utils/gs1'
import { lotSuggestions } from '../utils/lotSuggestions'
import { parseIntSafe } from '../utils/number'
import { formatShortDate } from '../utils/time'
import buttons from '../styles/buttons.module.css'
import forms from '../styles/forms.module.css'
import s from './AddLotForm.module.css'

// The two fields that start folded. Quantity and expiry are always on screen.
const FOLDABLE = ['lot', 'serial']

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
  const [fields, setFields] = useState({ qty: '', expiry: '', lotNumber: '', serialNumber: '' })
  const [adding, setAdding] = useState(false)
  // Shown under the quantity when it is missing. The browser's own `required`
  // popup was doing this job, but it speaks in a different register from the
  // inline errors the other two forms use — same criterion everywhere now.
  const [qtyError, setQtyError] = useState(null)
  // What the barcode contributed *beyond* the visible fields. The serial is not
  // here: it is a field the user can type, which the scanner merely prefills.
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scanNotice, setScanNotice] = useState(null)
  const [scanned, setScanned] = useState({ rawScan: '', parsed: null })
  // A past expiry is a property of the code that was read, so it is set once by
  // the scan. The duplicate serial is not — see `duplicateSerial` below.
  const [expiredBlocker, setExpiredBlocker] = useState(null)
  // Which of the two save buttons was pressed. A ref rather than state because
  // it is read once, inside the submit that the click itself triggers, and must
  // not cause a render. Both buttons stay `type="submit"`, so either goes
  // through `handleSubmit` and its validation.
  const keepOpenRef = useRef(false)
  const qtyRef = useRef(null)
  const scannerAvailable = useScannerAvailable()
  const disclosure = useFieldDisclosure(FOLDABLE)
  // The batches this product already has, each carrying the expiry that picking
  // it would inherit. Expired ones are dropped by the helper — the backend
  // refuses a past date, so suggesting one would autofill an unsaveable value.
  // Filtering, keyboard navigation and dismissal belong to `Combobox`.
  const suggestions = lotSuggestions(stock, today)
  // Set only by picking from the list, never by typing and never by a scan.
  const [expiryInherited, setExpiryInherited] = useState(false)

  // The product's learned default, as a form value. Adding a second lot in a
  // row must start from the same place as the first, so `resetForm` restores
  // it rather than blanking the field.
  const defaultQty = stock?.default_lot_quantity ? String(stock.default_lot_quantity) : ''

  // The serial the form currently holds, wherever it came from — typed, scanned,
  // or scanned and then edited.
  const serial = fields.serialNumber.trim()

  /**
   * Whether this serial is already on the product.
   *
   * Derived from the field rather than set by the scan handler, so a
   * hand-typed duplicate is caught before submitting instead of coming back as
   * a 400, and clearing the field unblocks with no special handling. A blank
   * serial is never a duplicate: most lots carry none, and `''` would match
   * every one of them.
   *
   * `useCreateStockLot` already appends the pending lot with its serial to
   * `stock.lots`, so two boxes registered back to back are covered too.
   */
  const duplicateSerial = serial !== '' && (stock?.lots ?? []).some((l) => l.serial_number === serial)

  // Expiry first, keeping the precedence the single blocker had: a box that is
  // both expired and already registered is expired, which is the worse news.
  const blocker = expiredBlocker ?? (duplicateSerial ? { key: 'scan.errorDuplicate', args: {} } : null)

  const resetForm = () => {
    setFields({ qty: defaultQty, expiry: '', lotNumber: '', serialNumber: '' })
    setScanned({ rawScan: '', parsed: null })
    setExpiredBlocker(null)
    setExpiryInherited(false)
  }

  const close = () => {
    resetForm()
    // Visibility belongs to the open form, not to the values: T051's
    // save-and-continue clears the fields and keeps the flags, so the reset
    // lives here rather than in `resetForm`.
    disclosure.reset()
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
      serialNumber: parsed.serialNumber ?? f.serialNumber,
    }))
    setScanned({ rawScan: raw, parsed })
    setScanNotice(null)
    // The date now comes off the box, not from a batch that was picked. A
    // misprint or a one-digit misread has to stay correctable.
    setExpiryInherited(false)

    // Only what the code actually carried: a payload with no AI 21 leaves the
    // serial folded.
    if (parsed.lotNumber) disclosure.reveal('lot')
    if (parsed.serialNumber) disclosure.reveal('serial')

    // Mirrors a rule the server enforces anyway; running it here turns a raw
    // 400 into an explanation, and works offline from cache. The duplicate
    // check is not here — it follows the field, so it catches a typed serial
    // too and clears itself when the field does.
    if (parsed.expiryDate && new Date(parsed.expiryDate) < today) {
      setExpiredBlocker({ key: 'scan.errorExpired', args: { date: formatShortDate(parsed.expiryDate) } })
    } else {
      setExpiredBlocker(null)
    }
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const keepOpen = keepOpenRef.current
    keepOpenRef.current = false
    // Gated here as well as on the button: a blocker must not be bypassable by
    // submitting the form.
    if (blocker) return
    if (!reachable) {
      showToast({ type: 'error', message: t('offline.pageUnavailable') })
      return
    }
    const quantity = parseIntSafe(fields.qty, -1)
    if (quantity < 0) {
      // Was a bare `return`: with the browser popup gone, an empty quantity
      // would have failed silently.
      setQtyError(t('inventory.errorQtyRequired'))
      qtyRef.current?.focus()
      return
    }
    setQtyError(null)

    setAdding(true)
    try {
      await onSubmit({
        quantity,
        expiryDate: fields.expiry,
        lotNumber: fields.lotNumber.trim(),
        serialNumber: serial,
        // Sent whenever a scan produced this lot, serial or not. A code with no
        // AI 21 still carries the GTIN, which is the only place it comes from.
        rawScan: scanned.rawScan,
        // Scan output, not a form field: the caller reconciles the product's
        // stored values against it.
        parsed: scanned.parsed,
      })
      setAdding(false)
      if (keepOpen) {
        // The next box is a different box, so every value clears — but the
        // fields the user needed for this one stay revealed, which is why the
        // disclosure reset lives in `close()` and not in `resetForm()`.
        resetForm()
        qtyRef.current?.focus()
      } else {
        close()
      }
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
        className={cx(s.addLotToggle, !reachable && buttons.disabled)}
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
            className={cx(buttons.btn, buttons.btnSecondary, s.scanBtn)}
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
          <FormField label={t('inventory.lotQty')} required error={qtyError}>
            <input
              ref={qtyRef}
              className={cx(forms.input, s.addLotInput)}
              type="number"
              min={0}
              placeholder="0"
              data-testid="qty-input"
              value={fields.qty}
              onChange={(e) => {
                setFields((f) => ({ ...f, qty: e.target.value }))
                setQtyError(null)
              }}
            />
          </FormField>
          <FormField label={t('inventory.lotExpiry')}>
            {/* Locked while inherited: one batch has one expiry, so a date that
                came from picking the batch is not the user's to edit. Typing in
                the batch field unlocks it again. */}
            <div className={expiryInherited ? forms.lockedInput : undefined}>
              <input
                className={cx(forms.input, s.addLotInput)}
                type="date"
                value={fields.expiry}
                onChange={(e) => setFields((f) => ({ ...f, expiry: e.target.value }))}
                readOnly={expiryInherited}
                data-testid="expiry-input"
              />
              {expiryInherited && (
                <span className={forms.lockBadge} title={t('inventory.expiryInherited')} data-testid="expiry-lock">
                  <Icon name="lock" size="sm" />
                </span>
              )}
            </div>
          </FormField>
          {/* Folded fields are absent from the DOM rather than hidden with CSS,
              so nothing unreachable sits in the tab order or the accessibility
              tree. */}
          {disclosure.isRevealed('lot') && (
            <FormField label={t('inventory.lotNumber')}>
              {/* Free text with suggestions: a batch this product has never seen
                  must be typeable, and the list is only a shortcut for the ones
                  it has. `Combobox` brings the keyboard navigation and the
                  `aria-activedescendant` the hand-rolled dropdown never had. */}
              <Combobox
                allowFreeText
                value={fields.lotNumber}
                // Every keystroke: a hand-typed batch number matches nothing and
                // so inherits nothing, which is what releases the expiry.
                onChange={(next) => {
                  setFields((f) => ({ ...f, lotNumber: next }))
                  setExpiryInherited(false)
                }}
                // Picking is an explicit act, so it overwrites a date the user
                // had already typed. A batch with no expiry inherits nothing and
                // locks nothing — there is no date to take.
                onSelect={(picked) => {
                  setFields((f) => ({ ...f, lotNumber: picked.lot_number, expiry: picked.expiry_date ?? f.expiry }))
                  setExpiryInherited(picked.expiry_date != null)
                }}
                options={suggestions}
                getLabel={(o) => o.lot_number}
                getKey={(o) => o.lot_number}
                // The expiry rides along in the list so the autofill is visibly
                // sourced rather than arriving from nowhere.
                renderOption={(o) => (
                  <span className={s.suggestion}>
                    <span>{o.lot_number}</span>
                    {o.expiry_date && <span className={s.suggestionExpiry}>{formatShortDate(o.expiry_date)}</span>}
                  </span>
                )}
                placeholder={t('inventory.lotNumberPlaceholder')}
                inputClassName={s.addLotInput}
                // `Combobox` spreads unknown props onto its input. The E2E
                // helper used to find this field by its placeholder text, which
                // broke the moment the copy became an example instead of the
                // label — a testid cannot rot that way.
                data-testid="lot-input"
              />
            </FormField>
          )}

          {/* An ordinary field the scanner happens to prefill, not a read-only
              artefact of the camera. A scratched code, a print too small to
              decode, or no camera at all must not stop the user registering the
              box — the backend has accepted a typed serial since day one. */}
          {disclosure.isRevealed('serial') && (
            <FormField label={t('inventory.lotSerial')}>
              <input
                className={cx(forms.input, s.addLotInput)}
                type="text"
                // The model caps `serial_number` at 20, which is the GS1 AI 21
                // limit. Without the cap the backend answers 400.
                maxLength={20}
                placeholder={t('inventory.lotSerialPlaceholder')}
                value={fields.serialNumber}
                onChange={(e) => setFields((f) => ({ ...f, serialNumber: e.target.value }))}
                data-testid="serial-input"
              />
            </FormField>
          )}
        </div>

        {disclosure.hasHidden && (
          <button type="button" className={s.moreFieldsBtn} onClick={disclosure.revealAll} data-testid="more-fields">
            <Icon name="plus" size="sm" />
            <span>{t('inventory.moreFields')}</span>
          </button>
        )}

        {blocker && (
          <p className={forms.error} data-testid="scan-blocker">
            {t(blocker.key, blocker.args)}
          </p>
        )}

        <div className={s.addLotActions}>
          <button type="button" className={cx(buttons.btn, buttons.btnSecondary)} onClick={close} disabled={adding}>
            {t('common.cancel')}
          </button>
          {/* Same gating as Save in every respect — a blocker or being offline
              refuses both. It differs only in not closing afterwards. */}
          <button
            type="submit"
            className={cx(buttons.btn, buttons.btnSecondary)}
            onClick={() => {
              keepOpenRef.current = true
            }}
            disabled={adding || Boolean(blocker)}
            data-testid="add-and-another"
          >
            {t('inventory.addAndAnother')}
          </button>
          <button type="submit" className={cx(buttons.btn, buttons.btnPrimary)} disabled={adding || Boolean(blocker)}>
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
