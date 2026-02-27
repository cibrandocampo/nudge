import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './RoutineFormPage.module.css'

const PRESET_HOURS = [8, 12, 24, 48, 168, 336, 720, 1440, 2160, 4320, 8760]

const UNIT_KEYS = ['hours', 'days', 'weeks', 'months', 'years']
const UNIT_FACTORS = { hours: 1, days: 24, weeks: 168, months: 720, years: 8760 }

function hoursToHuman(hours) {
  const h = Number(hours)
  const reversed = [...UNIT_KEYS].reverse()
  for (const key of reversed) {
    const factor = UNIT_FACTORS[key]
    if (h >= factor && h % factor === 0) return { value: h / factor, unit: key }
  }
  return { value: h, unit: 'hours' }
}

function formatPresetLabel(hours, t) {
  const human = hoursToHuman(hours)
  return `${human.value} ${t(`routine.form.${human.unit}`)}`
}

const EMPTY = { name: '', description: '', interval_hours: 24, stock: '', stock_usage: 1 }

export default function RoutineFormPage() {
  const { id } = useParams()
  const isEditing = Boolean(id)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [form, setForm] = useState(EMPTY)
  const [intervalValue, setIntervalValue] = useState(1)
  const [intervalUnit, setIntervalUnit] = useState('days')
  const [intervalDraft, setIntervalDraft] = useState(null) // string while focused
  const [stocks, setStocks] = useState([])
  const [usesStock, setUsesStock] = useState(false)
  const [loading, setLoading] = useState(isEditing)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [loadError, setLoadError] = useState(false)

  const applyInterval = (value, unit) => {
    const factor = UNIT_FACTORS[unit] ?? 1
    setForm((f) => ({ ...f, interval_hours: Number(value) * factor }))
  }

  useEffect(() => {
    api
      .get('/stock/')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setStocks(d.results ?? d))
      .catch(() => {})
    if (isEditing) {
      api
        .get(`/routines/${id}/`)
        .then((r) => {
          if (!r.ok) throw new Error()
          return r.json()
        })
        .then((r) => {
          const human = hoursToHuman(r.interval_hours)
          setIntervalValue(human.value)
          setIntervalUnit(human.unit)
          setForm({
            name: r.name,
            description: r.description,
            interval_hours: r.interval_hours,
            stock: r.stock ?? '',
            stock_usage: r.stock_usage,
          })
          setUsesStock(r.stock !== null)
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false))
    }
  }, [id, isEditing])

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const validate = () => {
    const err = {}
    if (!form.name.trim()) err.name = t('routine.form.errorName')
    if (!form.interval_hours || Number(form.interval_hours) <= 0) err.interval_hours = t('routine.form.errorInterval')
    return err
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validate()
    if (Object.keys(err).length) {
      setErrors(err)
      return
    }
    setSaving(true)
    setErrors({})
    const payload = {
      name: form.name.trim(),
      description: form.description,
      interval_hours: Number(form.interval_hours),
      stock: usesStock && form.stock ? Number(form.stock) : null,
      stock_usage: Number(form.stock_usage),
      is_active: true,
    }
    try {
      const res = isEditing ? await api.patch(`/routines/${id}/`, payload) : await api.post('/routines/', payload)
      if (!res.ok) throw new Error()
      const data = await res.json()
      navigate(isEditing ? `/routines/${id}` : `/routines/${data.id}`)
    } catch {
      setErrors({ submit: t('common.actionError') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className={shared.muted}>{t('common.loading')}</p>
  if (loadError) return <p className={shared.muted}>{t('common.error')}</p>

  const displayIntervalValue = intervalDraft !== null ? intervalDraft : String(intervalValue)

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <button type="button" className={s.back} onClick={() => navigate(-1)}>
          {t('common.back')}
        </button>
        <h1 className={shared.pageTitle}>{isEditing ? t('routine.form.editTitle') : t('routine.form.newTitle')}</h1>
      </div>

      <form onSubmit={handleSubmit} className={s.form}>
        <Field label={t('routine.form.name')} error={errors.name}>
          <input
            className={shared.input}
            value={form.name}
            onChange={field('name')}
            placeholder={t('routine.form.placeholder')}
            autoFocus
          />
        </Field>

        <Field label={t('routine.form.description')} hint={t('routine.form.optional')}>
          <textarea
            className={cx(shared.input, s.textarea)}
            value={form.description}
            onChange={field('description')}
            rows={2}
          />
        </Field>

        <Field label={t('routine.form.interval')} error={errors.interval_hours}>
          <div className={s.presets}>
            {PRESET_HOURS.map((hours) => {
              const active = Number(form.interval_hours) === hours
              return (
                <button
                  key={hours}
                  type="button"
                  className={cx(s.preset, active && s.presetActive)}
                  onClick={() => {
                    const human = hoursToHuman(hours)
                    setIntervalValue(human.value)
                    setIntervalUnit(human.unit)
                    setIntervalDraft(null)
                    setForm((f) => ({ ...f, interval_hours: hours }))
                  }}
                >
                  {formatPresetLabel(hours, t)}
                </button>
              )
            })}
          </div>
          <div className={s.customInterval}>
            <input
              className={cx(shared.input, s.inputNarrow)}
              type="number"
              min={1}
              value={displayIntervalValue}
              onFocus={() => setIntervalDraft('')}
              onChange={(e) => setIntervalDraft(e.target.value)}
              onBlur={() => {
                if (intervalDraft !== null) {
                  const v = Math.max(1, parseInt(intervalDraft, 10) || 1)
                  setIntervalValue(v)
                  setIntervalDraft(null)
                  applyInterval(v, intervalUnit)
                }
              }}
            />
            <select
              className={cx(shared.input, s.inputAuto)}
              value={intervalUnit}
              onChange={(e) => {
                setIntervalUnit(e.target.value)
                applyInterval(intervalValue, e.target.value)
              }}
            >
              {UNIT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {t(`routine.form.${key}`)}
                </option>
              ))}
            </select>
          </div>
        </Field>

        <Field label="">
          <label className={s.checkLabel}>
            <input type="checkbox" checked={usesStock} onChange={(e) => setUsesStock(e.target.checked)} />
            <span>{t('routine.form.trackStock')}</span>
          </label>
        </Field>

        {usesStock && (
          <>
            <Field label={t('routine.form.stockItem')}>
              <select className={shared.input} value={form.stock} onChange={field('stock')}>
                <option value="">{t('routine.form.selectDefault')}</option>
                {stocks.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name} ({st.quantity} left)
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('routine.form.unitsPerLog')}>
              <input
                className={cx(shared.input, s.inputStock)}
                type="number"
                min={1}
                value={form.stock_usage}
                onChange={field('stock_usage')}
              />
            </Field>
          </>
        )}

        {errors.submit && <p className={shared.error}>{errors.submit}</p>}
        <div className={s.buttons}>
          <button type="submit" className={s.saveBtn} disabled={saving}>
            {saving ? t('routine.form.saving') : t('routine.form.save')}
          </button>
          <button type="button" className={s.cancelBtn} onClick={() => navigate(-1)}>
            {t('routine.form.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children, error, hint }) {
  return (
    <div className={s.field}>
      {label && (
        <label className={s.label}>
          {label}
          {hint && <span className={s.hint}> · {hint}</span>}
        </label>
      )}
      {children}
      {error && <p className={shared.error}>{error}</p>}
    </div>
  )
}
