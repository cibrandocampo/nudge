import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import s from './DateRangePicker.module.css'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const PRESETS = [
  { key: 'last15', from: () => daysAgo(15), to: todayStr },
  { key: 'last30', from: () => daysAgo(30), to: todayStr },
  { key: 'last3m', from: () => monthsAgo(3), to: todayStr },
  { key: 'last6m', from: () => monthsAgo(6), to: todayStr },
  { key: 'allTime', from: () => '', to: () => '' },
]

function findActivePreset(dateFrom, dateTo) {
  const today = todayStr()
  for (const p of PRESETS) {
    const pFrom = p.from()
    const pTo = p.to()
    if (dateFrom === pFrom && (dateTo === pTo || (pTo === today && dateTo === today))) {
      return p.key
    }
  }
  return null
}

function formatLabel(t, dateFrom, dateTo) {
  const preset = findActivePreset(dateFrom, dateTo)
  if (preset) return t(`dateRange.${preset}`)
  if (!dateFrom && !dateTo) return t('dateRange.allTime')
  const fmt = (d) => {
    const date = new Date(d + 'T00:00:00')
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }
  const from = dateFrom ? fmt(dateFrom) : '...'
  const to = dateTo ? fmt(dateTo) : '...'
  return `${from} – ${to}`
}

export default function DateRangePicker({ dateFrom, dateTo, onChange }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [localFrom, setLocalFrom] = useState(dateFrom)
  const [localTo, setLocalTo] = useState(dateTo)
  const ref = useRef(null)

  useEffect(() => {
    if (open) {
      setLocalFrom(dateFrom)
      setLocalTo(dateTo)
    }
  }, [open, dateFrom, dateTo])

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const selectPreset = (preset) => {
    onChange({ dateFrom: preset.from(), dateTo: preset.to() })
    setOpen(false)
  }

  const applyCustom = () => {
    onChange({ dateFrom: localFrom, dateTo: localTo })
    setOpen(false)
  }

  const activePreset = findActivePreset(dateFrom, dateTo)

  return (
    <div className={s.wrapper} ref={ref}>
      <button
        type="button"
        className={s.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {formatLabel(t, dateFrom, dateTo)}
      </button>

      {open && (
        <div className={s.popover} role="dialog" aria-label={t('dateRange.label')}>
          <div className={s.presets}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={cx(s.presetBtn, activePreset === p.key && s.presetBtnActive)}
                onClick={() => selectPreset(p)}
              >
                {t(`dateRange.${p.key}`)}
              </button>
            ))}
          </div>

          <div className={s.custom}>
            <div className={s.field}>
              <label className={s.fieldLabel}>{t('dateRange.from')}</label>
              <input
                type="date"
                className={s.dateInput}
                value={localFrom}
                onChange={(e) => setLocalFrom(e.target.value)}
              />
            </div>
            <div className={s.field}>
              <label className={s.fieldLabel}>{t('dateRange.to')}</label>
              <input type="date" className={s.dateInput} value={localTo} onChange={(e) => setLocalTo(e.target.value)} />
            </div>
            <button type="button" className={s.applyBtn} onClick={applyCustom}>
              {t('dateRange.apply')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
