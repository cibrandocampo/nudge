import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import ConfirmModal from '../components/ConfirmModal'
import FormField from '../components/FormField'
import Icon from '../components/Icon'
import IntervalPicker from '../components/IntervalPicker'
import QueryHandler from '../components/QueryHandler'
import ShareWithSection from '../components/ShareWithSection'
import { fullName } from '../utils/displayName'
import { useContacts } from '../hooks/useContacts'
import { useRoutine } from '../hooks/useRoutines'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockList } from '../hooks/useStock'
import { useCreateRoutine } from '../hooks/mutations/useCreateRoutine'
import { useUpdateRoutine } from '../hooks/mutations/useUpdateRoutine'
import { useUpdateStock } from '../hooks/mutations/useUpdateStock'
import cx from '../utils/cx'
import { errorToastMessage } from '../utils/errors'
import { findCachedStock } from '../utils/lotsForSelection'
import { hoursToHuman } from '../utils/interval'
import { parseIntSafe } from '../utils/number'
import shared from '../styles/shared.module.css'
import s from './RoutineFormPage.module.css'

function toLocalDateTimeString(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

function updatePhase(phases, index, patch) {
  return phases.map((p, i) => (i === index ? { ...p, ...patch } : p))
}

const EMPTY = {
  name: '',
  description: '',
  interval_hours: 24,
  reminder_mode: 'daily',
  reminder_interval_minutes: 120,
  respect_quiet_hours: true,
  interval_phases: null,
  stock: '',
  stock_usage: 1,
}

const REMINDER_INTERVAL_CHOICES = [60, 120, 240, 480]

function computeUsersNeedingStockShare(addedRecipients, cachedStock) {
  const stockShared = new Set((cachedStock?.shared_with ?? []).map(Number))
  return addedRecipients.filter((id) => !stockShared.has(Number(id)))
}

export default function RoutineFormPage() {
  const { id } = useParams()
  const isEditing = Boolean(id)
  const navigate = useNavigate()
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data: stocks = [] } = useStockList()
  const { data: contacts = [] } = useContacts()
  const {
    data: routine,
    isLoading: routineLoading,
    isError: routineError,
    error: routineErrorObj,
  } = useRoutine(isEditing ? id : null)
  const createRoutine = useCreateRoutine()
  const updateRoutine = useUpdateRoutine()
  const updateStock = useUpdateStock()
  const reachable = useServerReachable()

  const [form, setForm] = useState(EMPTY)
  const [usesStock, setUsesStock] = useState(false)
  const [sharedWith, setSharedWith] = useState([])
  const [lastDoneEnabled, setLastDoneEnabled] = useState(false)
  const [lastDoneAt, setLastDoneAt] = useState('')
  const [errors, setErrors] = useState({})
  const [coupledShareConfirm, setCoupledShareConfirm] = useState(null)
  const [showIntervalHelp, setShowIntervalHelp] = useState(false)

  // Prefill once the edit routine is loaded.
  useEffect(() => {
    if (!isEditing || !routine) return
    setForm({
      name: routine.name,
      description: routine.description,
      interval_hours: routine.interval_hours,
      // Defensive `??` fallbacks so a cached routine fetched before the
      // T185 contract landed (no reminder_* keys) still hydrates the form
      // with sensible defaults.
      reminder_mode: routine.reminder_mode ?? 'daily',
      reminder_interval_minutes: routine.reminder_interval_minutes ?? 120,
      respect_quiet_hours: routine.respect_quiet_hours ?? true,
      interval_phases: routine.interval_phases ?? null,
      stock: routine.stock ?? '',
      stock_usage: routine.stock_usage,
    })
    setUsesStock(routine.stock !== null)
    setSharedWith(Array.isArray(routine.shared_with) ? routine.shared_with : [])
  }, [isEditing, routine])

  // Defensive: shared users who deep-link to /routines/:id/edit hit a backend
  // 403 on save (`IsOwner` permission). The detail page already hides the
  // Edit button for them; this redirect catches the deep-link path so they
  // never see a form they can't submit.
  useEffect(() => {
    if (isEditing && routine && routine.is_owner === false) {
      navigate(`/routines/${id}`, { replace: true })
    }
  }, [isEditing, routine, id, navigate])

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleToggleStock = (next) => {
    setUsesStock(next)
    if (!next) setForm((f) => ({ ...f, stock: '', stock_usage: 1 }))
  }

  const handleToggleLastDone = (next) => {
    setLastDoneEnabled(next)
    if (next && !lastDoneAt) setLastDoneAt(toLocalDateTimeString(new Date()))
    if (!next) setLastDoneAt('')
  }

  const validate = () => {
    const err = {}
    if (!form.name.trim()) err.name = t('routine.form.errorName')
    const phases = form.interval_phases
    const multi = Array.isArray(phases) && phases.length >= 2
    if (!multi) {
      if (!form.interval_hours || Number(form.interval_hours) <= 0) err.interval_hours = t('routine.form.errorInterval')
    } else {
      phases.forEach((phase, i) => {
        if (!phase.interval_hours || phase.interval_hours < 1)
          err[`phase_interval_${i}`] = t('routine.form.errorPhaseInterval')
        if (i < phases.length - 1 && (!phase.count || phase.count < 1))
          err[`phase_count_${i}`] = t('routine.form.errorPhaseCount')
      })
    }
    return err
  }

  const runSave = async (payload) => {
    if (isEditing) {
      await updateRoutine.mutateAsync({
        routineId: Number(id),
        routineName: payload.name ?? routine?.name,
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
  }

  const runCoupledSave = async (payload, cachedStock, newRecipientIds) => {
    setCoupledShareConfirm(null)
    const nextStockShared = Array.from(
      new Set([...(cachedStock?.shared_with ?? []).map(Number), ...newRecipientIds.map(Number)]),
    )
    try {
      await updateStock.mutateAsync({
        stockId: cachedStock.id,
        stockName: cachedStock.name,
        patch: { shared_with: nextStockShared },
        updatedAt: cachedStock.updated_at,
      })
    } catch {
      setErrors({ submit: t('errors.stockShareFailed') })
      return
    }
    try {
      await runSave(payload)
    } catch {
      setErrors({ submit: t('errors.routineSavedAfterStockShared') })
    }
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
      ...(Array.isArray(form.interval_phases) && form.interval_phases.length >= 2
        ? { interval_phases: form.interval_phases }
        : { interval_hours: Number(form.interval_hours), interval_phases: null }),
      reminder_mode: form.reminder_mode,
      reminder_interval_minutes: form.reminder_interval_minutes,
      respect_quiet_hours: form.respect_quiet_hours,
      stock: usesStock && form.stock ? Number(form.stock) : null,
      stock_usage: parseIntSafe(form.stock_usage, 1),
      shared_with: sharedWith,
      is_active: true,
    }
    if (!isEditing && lastDoneEnabled && lastDoneAt) {
      payload.backdated_first_entry_at = new Date(lastDoneAt).toISOString()
    }

    const original = isEditing ? new Set((routine?.shared_with ?? []).map(Number)) : new Set()
    const addedRecipients = sharedWith.map(Number).filter((rid) => !original.has(rid))
    const stockId = payload.stock
    const cachedStock = stockId != null ? findCachedStock(queryClient, stockId) : null
    const usersNeedingStockShare = computeUsersNeedingStockShare(addedRecipients, cachedStock)

    if (stockId != null && cachedStock && usersNeedingStockShare.length > 0) {
      const userIdToName = (uid) => {
        const c = contacts.find((x) => x.id === Number(uid))
        return c ? fullName(c) : String(uid)
      }
      const userLabels = usersNeedingStockShare.map(userIdToName)
      setCoupledShareConfirm({
        stockName: cachedStock.name ?? '',
        users: userLabels,
        onConfirm: () => runCoupledSave(payload, cachedStock, usersNeedingStockShare),
      })
      return
    }

    try {
      await runSave(payload)
    } catch (err) {
      setErrors({ submit: errorToastMessage(err, t) })
    }
  }

  const saving = createRoutine.isPending || updateRoutine.isPending
  const disabledCreate = !isEditing && !reachable

  return (
    <QueryHandler
      isLoading={isEditing && routineLoading}
      isError={isEditing && routineError}
      error={routineErrorObj}
      data={isEditing ? routine : undefined}
      notFound={isEditing && !routineLoading && !routineError && !routine}
      notFoundKey="routine.detail.notFound"
    >
      <div>
        <div className={shared.topBar}>
          <button type="button" className={s.back} onClick={() => navigate(-1)}>
            {t('common.backToRoutines')}
          </button>
          <h1 className={shared.pageTitle}>{isEditing ? t('routine.form.editTitle') : t('routine.form.newTitle')}</h1>
        </div>

        <form onSubmit={handleSubmit} className={s.form} noValidate>
          {/* Basics */}
          <section className={shared.formSection}>
            <FormField label={t('routine.form.name')} error={errors.name}>
              <input
                className={shared.input}
                value={form.name}
                onChange={field('name')}
                placeholder={t('routine.form.placeholder')}
                autoFocus
              />
            </FormField>
            <FormField label={t('routine.form.description')} hint={t('routine.form.optional')}>
              <textarea
                className={cx(shared.input, s.textarea)}
                value={form.description}
                onChange={field('description')}
                rows={2}
              />
            </FormField>
          </section>

          {/* Schedule — a single progressive editor: one interval row by
              default; "Add interval" turns it into a multi-phase sequence
              where every row but the last repeats a fixed number of times. */}
          <section className={shared.formSection}>
            <div className={shared.formSectionHeader}>
              <span className={shared.inputLabel}>{t('routine.form.interval')}</span>
              <div className={s.intervalHeaderActions}>
                <button
                  type="button"
                  className={s.intervalInfoBtn}
                  onClick={() => setShowIntervalHelp((v) => !v)}
                  aria-expanded={showIntervalHelp}
                  aria-label={t('routine.form.intervalHelpAria')}
                  title={t('routine.form.intervalHelpAria')}
                >
                  <Icon name="info" size="sm" />
                </button>
                <button
                  type="button"
                  className={shared.btnAdd}
                  onClick={() =>
                    setForm((f) => {
                      const cur =
                        Array.isArray(f.interval_phases) && f.interval_phases.length >= 2
                          ? f.interval_phases
                          : [{ interval_hours: Number(f.interval_hours) || 24 }]
                      const withCounts = cur.map((r, idx) =>
                        idx === cur.length - 1 ? { ...r, count: r.count ?? 1 } : r,
                      )
                      return { ...f, interval_phases: [...withCounts, { interval_hours: 168 }] }
                    })
                  }
                  aria-label={t('routine.form.addInterval')}
                  title={t('routine.form.addInterval')}
                >
                  <Icon name="plus" />
                </button>
              </div>
            </div>
            {showIntervalHelp && <p className={s.intervalHelp}>{t('routine.form.intervalHelp')}</p>}
            {(() => {
              const phases = form.interval_phases
              const multi = Array.isArray(phases) && phases.length >= 2
              const rows = multi ? phases : [{ interval_hours: Number(form.interval_hours) || 24 }]
              return (
                <div className={s.intervalEditor}>
                  {rows.map((row, i) => {
                    const isLast = i === rows.length - 1
                    return (
                      <div key={i} className={cx(s.intervalRow, multi && s.intervalCard)}>
                        <div className={s.intervalControls}>
                          <span className={s.intervalEvery}>
                            <span className={s.everyLabel}>{t('routine.form.phaseEvery')}</span>
                            <IntervalPicker
                              valueHours={row.interval_hours}
                              onChange={(hours) =>
                                setForm((f) => {
                                  if (!(Array.isArray(f.interval_phases) && f.interval_phases.length >= 2))
                                    return { ...f, interval_hours: hours }
                                  return {
                                    ...f,
                                    interval_phases: updatePhase(f.interval_phases, i, {
                                      interval_hours: hours,
                                    }),
                                  }
                                })
                              }
                              error={errors[`phase_interval_${i}`]}
                            />
                          </span>
                          {multi && !isLast && (
                            <span className={s.intervalCount}>
                              <span className={s.phaseDuringLabel}>{t('routine.form.phaseDuring')}</span>
                              <input
                                type="number"
                                min={1}
                                value={row.count ?? 1}
                                onChange={(e) => {
                                  const count = Number(e.target.value)
                                  setForm((f) => ({
                                    ...f,
                                    interval_phases: updatePhase(f.interval_phases, i, { count }),
                                  }))
                                }}
                                className={cx(shared.input, s.phaseCountInput)}
                              />
                              <span className={s.phaseDuringLabel}>{t('routine.form.phaseCount')}</span>
                            </span>
                          )}
                          {multi && isLast && (
                            <span className={s.intervalIndefinite}>{t('routine.form.phaseIndefinite')}</span>
                          )}
                          {multi && (
                            <button
                              type="button"
                              className={cx(shared.btnIcon, shared.btnIconDelete, s.intervalRemove)}
                              onClick={() =>
                                setForm((f) => {
                                  const next = f.interval_phases.filter((_, idx) => idx !== i)
                                  if (next.length <= 1)
                                    return {
                                      ...f,
                                      interval_hours: next[0]?.interval_hours ?? (Number(f.interval_hours) || 24),
                                      interval_phases: null,
                                    }
                                  return { ...f, interval_phases: next }
                                })
                              }
                              aria-label={t('routine.form.removeInterval')}
                              title={t('routine.form.removeInterval')}
                            >
                              <Icon name="x" size="sm" />
                            </button>
                          )}
                        </div>
                        {errors[`phase_count_${i}`] && <p className={s.phaseError}>{errors[`phase_count_${i}`]}</p>}
                      </div>
                    )
                  })}
                  {errors.interval_hours && <p className={shared.error}>{errors.interval_hours}</p>}

                  <div className={s.intervalSummary}>
                    {(() => {
                      const phrase = (row, isLast) => {
                        const { unit, value } = hoursToHuman(row.interval_hours)
                        const every = t(`routine.interval.${unit}`, { count: value })
                        if (!multi) return every
                        return isLast
                          ? `${every} ${t('routine.form.phaseIndefinite')}`
                          : `${every} ${t('routine.form.phaseDuring')} ${row.count ?? 1} ${t('routine.form.phaseCount')}`
                      }
                      return multi ? (
                        <ul className={s.summaryList}>
                          {rows.map((row, i) => (
                            <li key={i}>{phrase(row, i === rows.length - 1)}</li>
                          ))}
                        </ul>
                      ) : (
                        <span>{phrase(rows[0], true)}</span>
                      )
                    })()}
                  </div>
                </div>
              )
            })()}
          </section>

          {/* Stock tracking — header con toggle iOS-style */}
          <section className={shared.formSection}>
            <div className={shared.formSectionHeader}>
              <span className={shared.formSectionTitle}>{t('routine.form.stockTrackingTitle')}</span>
              <ToggleSwitch
                checked={usesStock}
                onChange={handleToggleStock}
                ariaLabel={t('routine.form.stockTrackingTitle')}
              />
            </div>
            {usesStock && (
              <>
                <FormField label={t('routine.form.stockItem')}>
                  <select
                    className={shared.input}
                    value={form.stock}
                    onChange={field('stock')}
                    aria-label={t('routine.form.stockItem')}
                  >
                    <option value="">{t('routine.form.selectDefault')}</option>
                    {stocks.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.is_owner === false
                          ? t('routine.form.sharedStockLabel', {
                              name: st.name,
                              qty: st.quantity,
                              owner: st.owner_display_name,
                            })
                          : `${st.name} (${st.quantity} left)`}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField label={t('routine.form.unitsPerLog')}>
                  <input
                    className={cx(shared.input, s.inputStock)}
                    type="number"
                    min={1}
                    value={form.stock_usage}
                    onChange={field('stock_usage')}
                  />
                </FormField>
              </>
            )}
          </section>

          {/* Share with */}
          <ShareWithSection
            value={sharedWith}
            onChange={setSharedWith}
            contacts={contacts}
            label={t('routine.form.shareLabel')}
          />

          {/* First completion — create only, header con toggle */}
          {!isEditing && (
            <section className={shared.formSection}>
              <div className={shared.formSectionHeader}>
                <span className={shared.formSectionTitle}>{t('routine.form.firstCompletionTitle')}</span>
                <ToggleSwitch
                  checked={lastDoneEnabled}
                  onChange={handleToggleLastDone}
                  ariaLabel={t('routine.form.firstCompletionTitle')}
                />
              </div>
              {lastDoneEnabled && (
                <FormField label={t('routine.form.firstCompletionWhen')}>
                  <input
                    className={cx(shared.input, s.lastDoneInput)}
                    type="datetime-local"
                    value={lastDoneAt}
                    max={toLocalDateTimeString(new Date())}
                    onChange={(e) => setLastDoneAt(e.target.value)}
                  />
                </FormField>
              )}
            </section>
          )}

          {/* Notifications — mode + (conditional) interval + respect toggle.
              Last block: Daily is the default; choosing Intensive reveals the
              repeat-interval picker + quiet-hours toggle. */}
          <section className={shared.formSection}>
            <FormField label={t('routine.form.reminderMode')}>
              <div className={s.modeOptions} role="radiogroup" aria-label={t('routine.form.reminderMode')}>
                {['daily', 'intensive'].map((mode) => (
                  <label key={mode} className={cx(s.modeOption, form.reminder_mode === mode && s.modeOptionActive)}>
                    <input
                      type="radio"
                      name="reminder_mode"
                      value={mode}
                      checked={form.reminder_mode === mode}
                      // The label wraps the input + a title span + a hint span, so the
                      // implicit accessible name would concatenate both spans. Pin it
                      // explicitly to the title so `getByRole('radio', { name: 'Daily' })`
                      // works in tests without leaking hint copy into the a11y tree.
                      aria-label={t(`routine.form.mode_${mode}`)}
                      // Preservation: only `reminder_mode` changes here.
                      // `reminder_interval_minutes` and `respect_quiet_hours`
                      // stay as the user left them, so toggling daily↔intensive
                      // doesn't reset the sub-block.
                      onChange={() => setForm((f) => ({ ...f, reminder_mode: mode }))}
                    />
                    <span className={s.modeLabel}>{t(`routine.form.mode_${mode}`)}</span>
                    <span className={s.modeHint}>{t(`routine.form.mode_${mode}_hint`)}</span>
                  </label>
                ))}
              </div>
            </FormField>

            {form.reminder_mode === 'intensive' && (
              <>
                <FormField label={t('routine.form.reminderInterval')}>
                  <div className={s.intervalSentence} role="radiogroup" aria-label={t('routine.form.reminderInterval')}>
                    <span className={s.everyLabel}>{t('routine.form.phaseEvery')}</span>
                    {REMINDER_INTERVAL_CHOICES.map((min) => (
                      <label
                        key={min}
                        className={cx(s.numChip, form.reminder_interval_minutes === min && s.numChipActive)}
                      >
                        <input
                          type="radio"
                          name="reminder_interval_minutes"
                          value={min}
                          checked={form.reminder_interval_minutes === min}
                          onChange={() => setForm((f) => ({ ...f, reminder_interval_minutes: min }))}
                          aria-label={t(`routine.form.interval_${min}`)}
                        />
                        <span>{min / 60}</span>
                      </label>
                    ))}
                    <span className={s.everyLabel}>{t('routine.form.hours')}</span>
                  </div>
                </FormField>

                <div className={cx(shared.formSectionHeader, s.quietHoursRow)}>
                  <div className={s.respectInfo}>
                    <span className={shared.formSectionTitle}>{t('routine.form.respectQuietHours')}</span>
                    <p className={shared.helpText}>{t('routine.form.respectQuietHoursHint')}</p>
                  </div>
                  <ToggleSwitch
                    checked={form.respect_quiet_hours}
                    onChange={(v) => setForm((f) => ({ ...f, respect_quiet_hours: v }))}
                    ariaLabel={t('routine.form.respectQuietHours')}
                  />
                </div>
              </>
            )}
          </section>

          {errors.submit && <p className={shared.error}>{errors.submit}</p>}
          {disabledCreate && <p className={shared.helpText}>{t('offline.requiresConnection')}</p>}

          <div className={shared.formFooter}>
            <button
              type="submit"
              className={cx(shared.btn, shared.btnPrimary, shared.formSecondaryBtn, s.submitBtn)}
              disabled={saving || disabledCreate}
              title={disabledCreate ? t('offline.requiresConnection') : undefined}
            >
              {saving ? t('routine.form.saving') : t('routine.form.save')}
            </button>
            <button
              type="button"
              className={cx(shared.btn, shared.btnSecondary, shared.formSecondaryBtn)}
              onClick={() => navigate(-1)}
            >
              {t('routine.form.cancel')}
            </button>
          </div>
        </form>
        {coupledShareConfirm && (
          <ConfirmModal
            message={t('sharing.coupledShareMessage', {
              stockName: coupledShareConfirm.stockName,
              users: coupledShareConfirm.users.join(', '),
            })}
            confirmLabel={t('sharing.coupledShareConfirm')}
            onConfirm={coupledShareConfirm.onConfirm}
            onCancel={() => setCoupledShareConfirm(null)}
          />
        )}
      </div>
    </QueryHandler>
  )
}

function ToggleSwitch({ checked, onChange, ariaLabel, disabled = false }) {
  return (
    <label className={shared.formToggleSwitch}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className={shared.formToggleTrack}>
        <span className={shared.formToggleThumb} />
      </span>
    </label>
  )
}
