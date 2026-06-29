import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UNIT_KEYS, clampValue, hoursToHuman, toHours } from '../utils/interval'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './IntervalPicker.module.css'

/**
 * Numeric amount input + unit dropdown bound to a single `interval_hours`
 * number. Internal state keeps `unit` + `value` + `draft`; `onChange`
 * fires the derived hours count whenever the user commits a change
 * (clamp-on-blur or unit switch).
 */
export default function IntervalPicker({ valueHours, onChange, error }) {
  const { t } = useTranslation()
  const initial = hoursToHuman(valueHours)
  const [unit, setUnit] = useState(initial.unit)
  const [value, setValue] = useState(initial.value || 1)
  const [draft, setDraft] = useState(null)

  // Sync with external valueHours changes. If the consumer replaces the
  // value (e.g. form reset, pre-fill on edit), reflect it here without
  // emitting a fresh onChange.
  useEffect(() => {
    const next = hoursToHuman(valueHours)
    setUnit(next.unit)
    setValue(next.value || 1)
    setDraft(null)
  }, [valueHours])

  const emit = (nextValue, nextUnit) => {
    onChange(toHours(nextValue, nextUnit))
  }

  const handleUnit = (nextUnit) => {
    if (nextUnit === unit) return
    const clamped = clampValue(value, nextUnit)
    setUnit(nextUnit)
    setValue(clamped)
    setDraft(null)
    emit(clamped, nextUnit)
  }

  const commitDraft = () => {
    if (draft === null) return
    const clamped = clampValue(draft, unit)
    setValue(clamped)
    setDraft(null)
    if (clamped !== value) emit(clamped, unit)
  }

  const displayValue = draft !== null ? draft : String(value)

  return (
    <div className={s.root}>
      <div className={s.controlRow}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className={cx(shared.input, s.amountInput)}
          value={displayValue}
          onFocus={() => setDraft('')}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
          aria-label={t(`routine.form.${unit}`)}
        />

        <select
          className={cx(shared.input, s.unitSelect)}
          value={unit}
          onChange={(e) => handleUnit(e.target.value)}
          aria-label={t('routine.form.unit')}
        >
          {UNIT_KEYS.map((key) => (
            <option key={key} value={key}>
              {t(`routine.form.${key}`)}
            </option>
          ))}
        </select>
      </div>

      {error && <p className={shared.error}>{error}</p>}
    </div>
  )
}
