import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ModalFrame from './ModalFrame'
import { allocateFromGroup, bulkQuantity } from '../utils/lotsForSelection'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './LotSelectionModal.module.css'

/**
 * Modal for selecting specific lots to consume when confirming a routine.
 *
 * Selection happens in up to two steps:
 *   1. pick the lot — one row per group from `lotsForSelection()`;
 *   2. pick the pack — only for a chosen group that holds serialized packs,
 *      since those are individually identified boxes. Groups without serials
 *      skip this step entirely and behave exactly as before.
 *
 * Whatever the path, `onConfirm` receives the same wire format as always:
 * `[{lot_id, quantity}]`. The API is untouched.
 *
 * Props:
 *   routine  — object with { name, stock_usage, stock_name }
 *   lots     — grouped lot list (FEFO order) from `lotsForSelection()`
 *   onConfirm(lotSelections) — called with [{lot_id, quantity}]
 *   onCancel
 */
export default function LotSelectionModal({ routine, lots: groups, onConfirm, onCancel }) {
  const { t } = useTranslation()
  const needed = routine.stock_usage
  const isSingle = needed === 1

  const [step, setStep] = useState('groups')
  const [selectedKey, setSelectedKey] = useState(isSingle && groups.length > 0 ? groups[0].key : null)
  const [quantities, setQuantities] = useState(() => {
    const init = Object.fromEntries(groups.map((group) => [group.key, 0]))
    let remaining = needed
    for (const group of groups) {
      if (remaining <= 0) break
      const take = Math.min(group.quantity, remaining)
      init[group.key] = take
      remaining -= take
    }
    return init
  })
  const [packChoices, setPackChoices] = useState({})
  const [pendingIndex, setPendingIndex] = useState(0)
  const [error, setError] = useState(null)

  const allocatedFor = (group) => (isSingle ? (selectedKey === group.key ? 1 : 0) : (quantities[group.key] ?? 0))
  const total = groups.reduce((sum, group) => sum + allocatedFor(group), 0)

  // The pack step only earns its place when there is something to choose
  // between: a lot holding a single identified box has no ambiguity, so it is
  // taken automatically however many units come out of it.
  const pendingGroups = groups.filter((group) => allocatedFor(group) > 0 && group.packs.length > 1)
  const currentGroup = pendingGroups[pendingIndex] ?? null

  const preselectPacks = (group) => group.packs.slice(0, allocatedFor(group)).map((pack) => pack.lot_id)

  const choicesFor = (group, choices) =>
    group.packs.length === 1 ? [group.packs[0].lot_id] : (choices[group.key] ?? [])

  const buildSelections = (choices) =>
    groups.flatMap((group) => allocateFromGroup(group, allocatedFor(group), choicesFor(group, choices)))

  const handleSelectRadio = (key) => {
    setSelectedKey(key)
    setError(null)
  }

  const handleStep = (key, maxQty, delta) => {
    setQuantities((prev) => ({ ...prev, [key]: Math.max(0, Math.min(maxQty, prev[key] + delta)) }))
    setError(null)
  }

  const handleGroupsConfirm = () => {
    if (total !== needed) {
      setError(t('lot.modal.errorTotal', { needed, total }))
      return
    }
    if (pendingGroups.length === 0) {
      onConfirm(buildSelections(packChoices))
      return
    }
    const choices = { ...packChoices, [pendingGroups[0].key]: preselectPacks(pendingGroups[0]) }
    setPackChoices(choices)
    setPendingIndex(0)
    setError(null)
    setStep('packs')
  }

  const togglePack = (lotId) => {
    const allocated = allocatedFor(currentGroup)
    setPackChoices((prev) => {
      const chosen = prev[currentGroup.key] ?? []
      if (allocated === 1) return { ...prev, [currentGroup.key]: [lotId] }
      if (chosen.includes(lotId)) {
        return { ...prev, [currentGroup.key]: chosen.filter((id) => id !== lotId) }
      }
      if (chosen.length >= allocated) return prev
      return { ...prev, [currentGroup.key]: [...chosen, lotId] }
    })
    setError(null)
  }

  const handlePacksConfirm = () => {
    const allocated = allocatedFor(currentGroup)
    const chosen = packChoices[currentGroup.key] ?? []
    // Any shortfall is covered by the group's unidentified units; without them
    // the user must name every box being consumed.
    if (chosen.length + bulkQuantity(currentGroup) < allocated) {
      setError(t('lot.modal.errorPackCount', { needed: allocated, total: chosen.length }))
      return
    }
    if (pendingIndex + 1 < pendingGroups.length) {
      const next = pendingGroups[pendingIndex + 1]
      setPackChoices((prev) => ({ ...prev, [next.key]: preselectPacks(next) }))
      setPendingIndex(pendingIndex + 1)
      setError(null)
      return
    }
    onConfirm(buildSelections(packChoices))
  }

  const handleBack = () => {
    setError(null)
    if (pendingIndex > 0) {
      setPendingIndex(pendingIndex - 1)
      return
    }
    setStep('groups')
  }

  const groupLabel = (group) => group.lot_number ?? t('lot.modal.noId')

  if (step === 'packs' && currentGroup) {
    const allocated = allocatedFor(currentGroup)
    const chosen = packChoices[currentGroup.key] ?? []
    return (
      <ModalFrame onClose={onCancel} size="lg">
        <h2 className={s.title}>{t('lot.modal.pickPack')}</h2>
        <p className={s.subtitle}>
          {groupLabel(currentGroup)} · {t('lot.modal.packCount', { count: currentGroup.packs.length })}
        </p>

        <ul className={s.list} role="group" aria-label={t('lot.modal.pickPack')}>
          {currentGroup.packs.map((pack) => {
            const selected = chosen.includes(pack.lot_id)
            return (
              <li
                key={pack.lot_id}
                className={`${s.item} ${selected ? s.itemSelected : ''}`}
                onClick={() => togglePack(pack.lot_id)}
                role={allocated === 1 ? 'radio' : 'checkbox'}
                aria-checked={selected}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && togglePack(pack.lot_id)}
                data-testid="pack-row"
                data-lot-id={pack.lot_id}
              >
                <span className={s.radio}>{selected ? '●' : ''}</span>
                {/* The serial stands alone: every pack row in this list is one
                    physical box, so labelling it "Serial" repeats the list. */}
                <span className={cx(s.label, s.packSerial)}>{pack.serial_number}</span>
              </li>
            )
          })}
          {bulkQuantity(currentGroup) > 0 &&
            (allocated === 1 ? (
              // With a single unit to consume, the group's anonymous units are
              // a real alternative to naming a box — so they are selectable.
              <li
                className={`${s.item} ${chosen.length === 0 ? s.itemSelected : ''}`}
                onClick={() => setPackChoices((prev) => ({ ...prev, [currentGroup.key]: [] }))}
                role="radio"
                aria-checked={chosen.length === 0}
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setPackChoices((prev) => ({ ...prev, [currentGroup.key]: [] }))}
                data-testid="bulk-row"
              >
                <span className={s.radio}>{chosen.length === 0 ? '●' : ''}</span>
                <span className={s.label}>{t('lot.modal.unidentifiedUnits')}</span>
                <span className={s.available}>
                  {bulkQuantity(currentGroup)} {t('lot.modal.available')}
                </span>
              </li>
            ) : (
              // With several units, any shortfall is taken from here
              // automatically, so the row is informational.
              <li className={s.itemStatic} data-testid="bulk-row">
                <span className={s.label}>{t('lot.modal.unidentifiedUnits')}</span>
                <span className={s.available}>
                  {bulkQuantity(currentGroup)} {t('lot.modal.available')}
                </span>
              </li>
            ))}
        </ul>

        {allocated > 1 && (
          <p className={s.totalRow}>
            {t('lot.modal.total')}:{' '}
            <span className={s.qty}>
              {chosen.length}/{allocated}
            </span>
          </p>
        )}

        {error && <p className={s.error}>{error}</p>}

        <div className={s.actions}>
          <button className={shared.btnCancel} onClick={handleBack}>
            {t('lot.modal.back')}
          </button>
          <button className={shared.btnConfirm} onClick={handlePacksConfirm} data-testid="pack-confirm">
            {t('lot.modal.confirm')}
          </button>
        </div>
      </ModalFrame>
    )
  }

  return (
    <ModalFrame onClose={onCancel} size="lg">
      <h2 className={s.title}>{t('lot.modal.title')}</h2>
      <p className={s.subtitle}>
        {isSingle ? t('lot.modal.subtitleSingle') : t('lot.modal.subtitleMulti', { count: needed })}
      </p>

      <ul className={s.list}>
        {groups.map((group) =>
          isSingle ? (
            <li
              key={group.key}
              className={`${s.item} ${selectedKey === group.key ? s.itemSelected : ''}`}
              onClick={() => handleSelectRadio(group.key)}
              role="radio"
              aria-checked={selectedKey === group.key}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && handleSelectRadio(group.key)}
              data-testid="lot-group-row"
            >
              <span className={s.radio}>{selectedKey === group.key ? '●' : ''}</span>
              <span className={s.label}>{groupLabel(group)}</span>
              <span className={s.available}>
                {group.quantity} {t('lot.modal.available')}
              </span>
              {group.expiry_date && <span className={s.expiry}>{group.expiry_date}</span>}
            </li>
          ) : (
            <li key={group.key} className={s.itemMulti} data-testid="lot-group-row">
              <div className={s.lotHeader}>
                <span className={s.label}>{groupLabel(group)}</span>
                <span className={s.available}>
                  {group.quantity} {t('lot.modal.available')}
                </span>
                {group.expiry_date && <span className={s.expiry}>{group.expiry_date}</span>}
              </div>
              <div className={s.qtyRow}>
                <button
                  type="button"
                  className={s.stepBtn}
                  disabled={quantities[group.key] <= 0}
                  onClick={() => handleStep(group.key, group.quantity, -1)}
                  aria-label="Decrease"
                >
                  -
                </button>
                <span className={s.qtyValue}>{quantities[group.key]}</span>
                <button
                  type="button"
                  className={s.stepBtn}
                  disabled={quantities[group.key] >= group.quantity}
                  onClick={() => handleStep(group.key, group.quantity, 1)}
                  aria-label="Increase"
                >
                  +
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {!isSingle && (
        <p className={s.totalRow}>
          {t('lot.modal.total')}:{' '}
          <span className={s.qty}>
            {total}/{needed}
          </span>
        </p>
      )}

      {error && <p className={s.error}>{error}</p>}

      <div className={s.actions}>
        <button className={shared.btnCancel} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className={shared.btnConfirm} onClick={handleGroupsConfirm} disabled={!isSingle && total !== needed}>
          {t('lot.modal.confirm')}
        </button>
      </div>
    </ModalFrame>
  )
}
