import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useRoutine } from '../hooks/useRoutines'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockList } from '../hooks/useStock'
import { useCreateRoutine } from '../hooks/mutations/useCreateRoutine'
import { useUpdateRoutine } from '../hooks/mutations/useUpdateRoutine'
import { OfflineError } from '../api/errors'
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

function toLocalDateTimeString(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

const EMPTY = { name: '', description: '', interval_hours: 24, stock: '', stock_usage: 1 }

export default function RoutineFormPage() {
  const { id } = useParams()
  const isEditing = Boolean(id)
  const navigate = useNavigate()
  const { t } = useTranslation()

  const { data: stocks = [] } = useStockList()
  const { data: routine, isLoading: routineLoading, isError: routineError } = useRoutine(isEditing ? id : null)
  const createRoutine = useCreateRoutine()
  const updateRoutine = useUpdateRoutine()
  const reachable = useServerReachable()

  const [form, setForm] = useState(EMPTY)
  const [intervalValue, setIntervalValue] = useState(1)
  const [intervalUnit, setIntervalUnit] = useState('days')
  const [intervalDraft, setIntervalDraft] = useState(null)
  const [usesStock, setUsesStock] = useState(false)
  const [lastDoneEnabled, setLastDoneEnabled] = useState(false)
  const [lastDoneAt, setLastDoneAt] = useState('')
  const [errors, setErrors] = useState({})

  const applyInterval = (value, unit) => {
    const factor = UNIT_FACTORS[unit] ?? 1
    setForm((f) => ({ ...f, interval_hours: Number(value) * factor }))
  }

  // Prefill form once the edit routine is loaded.
  useEffect(() => {
    if (!isEditing || !routine) return
    const human = hoursToHuman(routine.interval_hours)
    setIntervalValue(human.value)
    setIntervalUnit(human.unit)
    setForm({
      name: routine.name,
      description: routine.description,
      interval_hours: routine.interval_hours,
      stock: routine.stock ?? '',
      stock_usage: routine.stock_usage,
    })
    setUsesStock(routine.stock !== null)
  }, [isEditing, routine])

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
    setErrors({})
    const payload = {
      name: form.name.trim(),
      description: form.description,
      interval_hours: Number(form.interval_hours),
      stock: usesStock && form.stock ? Number(form.stock) : null,
      stock_usage: Number(form.stock_usage),
      is_active: true,
    }
    if (!isEditing && lastDoneEnabled && lastDoneAt) {
      payload.last_done_at = new Date(lastDoneAt).toISOString()
    }

    try {
      if (isEditing) {
        await updateRoutine.mutateAsync({
          routineId: Number(id),
          patch: payload,
          updatedAt: routine?.updated_at,
        })
        navigate(`/routines/${id}`)
      } else {
        // `useCreateRoutine` is online-only (T060), so it always resolves
        // with the server payload here — no `__queued` branch to handle.
        const result = await createRoutine.mutateAsync({ payload })
        navigate(`/routines/${result.id}`)
      }
    } catch (err) {
      const message = err instanceof OfflineError ? t('offline.actionUnavailable') : t('common.actionError')
      setErrors({ submit: message })
    }
  }

  if (isEditing && routineLoading) return <div className={shared.spinner} />
  if (isEditing && routineError) return <p className={shared.muted}>{t('common.error')}</p>

  const displayIntervalValue = intervalDraft !== null ? intervalDraft : String(intervalValue)
  const saving = createRoutine.isPending || updateRoutine.isPending

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
                    {st.is_owner === false
                      ? t('routine.form.sharedStockLabel', {
                          name: st.name,
                          qty: st.quantity,
                          owner: st.owner_username,
                        })
                      : `${st.name} (${st.quantity} left)`}
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

        {!isEditing && (
          <Field label="">
            <label className={s.checkLabel}>
              <input
                type="checkbox"
                checked={lastDoneEnabled}
                onChange={(e) => {
                  setLastDoneEnabled(e.target.checked)
                  if (e.target.checked && !lastDoneAt) {
                    setLastDoneAt(toLocalDateTimeString(new Date()))
                  }
                }}
              />
              <span>{t('routine.form.lastDoneToggle')}</span>
            </label>
            {lastDoneEnabled && (
              <input
                className={cx(shared.input, s.lastDoneInput)}
                type="datetime-local"
                value={lastDoneAt}
                max={toLocalDateTimeString(new Date())}
                onChange={(e) => setLastDoneAt(e.target.value)}
              />
            )}
          </Field>
        )}

        {errors.submit && <p className={shared.error}>{errors.submit}</p>}
        {!isEditing && !reachable && <p className={shared.helpText}>{t('offline.requiresConnection')}</p>}
        <div className={s.buttons}>
          <button
            type="submit"
            className={cx(shared.btn, shared.btnPrimary, s.saveBtn)}
            disabled={saving || (!isEditing && !reachable)}
            title={!isEditing && !reachable ? t('offline.requiresConnection') : undefined}
          >
            {saving ? t('routine.form.saving') : t('routine.form.save')}
          </button>
          <button
            type="button"
            className={cx(shared.btn, shared.btnSecondary, s.cancelBtn)}
            onClick={() => navigate(-1)}
          >
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
        <label className={cx(shared.inputLabel, s.label)}>
          {label}
          {hint && <span className={s.hint}> · {hint}</span>}
        </label>
      )}
      {children}
      {error && <p className={shared.error}>{error}</p>}
    </div>
  )
}
