import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import ConfirmModal from '../components/ConfirmModal'
import FormField from '../components/FormField'
import IntervalPicker from '../components/IntervalPicker'
import QueryHandler from '../components/QueryHandler'
import ShareWithSection from '../components/ShareWithSection'
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

const EMPTY = { name: '', description: '', interval_hours: 24, stock: '', stock_usage: 1 }

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

  // Prefill once the edit routine is loaded.
  useEffect(() => {
    if (!isEditing || !routine) return
    setForm({
      name: routine.name,
      description: routine.description,
      interval_hours: routine.interval_hours,
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
    if (!form.interval_hours || Number(form.interval_hours) <= 0) err.interval_hours = t('routine.form.errorInterval')
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
      interval_hours: Number(form.interval_hours),
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
      const userIdToName = (uid) => contacts.find((c) => c.id === Number(uid))?.username ?? String(uid)
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

        <form onSubmit={handleSubmit} className={s.form}>
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

          {/* Schedule */}
          <section className={shared.formSection}>
            <FormField label={t('routine.form.interval')}>
              <IntervalPicker
                valueHours={Number(form.interval_hours) || 0}
                onChange={(hours) => setForm((f) => ({ ...f, interval_hours: hours }))}
                error={errors.interval_hours}
              />
            </FormField>
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
