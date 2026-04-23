import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UNIT_KEYS, UNIT_MAX_VALUES, clampValue, hoursToHuman, toHours } from '../utils/interval'
import cx from '../utils/cx'
import Icon from './Icon'
import shared from '../styles/shared.module.css'
import s from './IntervalPicker.module.css'

/**
 * Segmented unit picker + numeric stepper bound to a single
 * `interval_hours` number. Internal state keeps `unit` + `value` +
 * `draft`; `onChange` fires the derived hours count whenever the user
 * commits a change (step, clamp-on-blur, or unit switch).
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

  const handleStep = (delta) => {
    const clamped = clampValue(value + delta, unit)
    if (clamped === value) return
    setValue(clamped)
    setDraft(null)
    emit(clamped, unit)
  }

  const commitDraft = () => {
    if (draft === null) return
    const clamped = clampValue(draft, unit)
    setValue(clamped)
    setDraft(null)
    if (clamped !== value) emit(clamped, unit)
  }

  const max = UNIT_MAX_VALUES[unit]
  const atMin = value <= 1
  const atMax = value >= max
  const displayValue = draft !== null ? draft : String(value)

  return (
    <div className={s.root}>
      <div className={s.segmented} role="tablist">
        {UNIT_KEYS.map((key) => {
          const active = unit === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className={cx(s.segmentedItem, active && s.segmentedItemActive)}
              onClick={() => handleUnit(key)}
            >
              {t(`routine.form.${key}`)}
            </button>
          )
        })}
      </div>

      <div className={s.stepperRow}>
        <button
          type="button"
          className={s.stepperBtn}
          onClick={() => handleStep(-1)}
          disabled={atMin}
          aria-label={t('routine.form.decrement')}
          title={t('routine.form.decrement')}
        >
          <Icon name="minus" size="sm" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className={s.stepperInput}
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
        <button
          type="button"
          className={s.stepperBtn}
          onClick={() => handleStep(1)}
          disabled={atMax}
          aria-label={t('routine.form.increment')}
          title={t('routine.form.increment')}
        >
          <Icon name="plus" size="sm" />
        </button>
        <span className={s.stepperHint}>· {t(`routine.interval.${unit}`, { count: value })}</span>
      </div>

      {error && <p className={shared.error}>{error}</p>}
    </div>
  )
}
