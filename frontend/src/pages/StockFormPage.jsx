import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { OfflineError } from '../api/errors'
import Icon from '../components/Icon'
import ShareWithSection from '../components/ShareWithSection'
import { useContacts } from '../hooks/useContacts'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStock, useStockGroups } from '../hooks/useStock'
import { useCreateStock } from '../hooks/mutations/useCreateStock'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useUpdateStock } from '../hooks/mutations/useUpdateStock'
import { useToast } from '../components/useToast'
import cx from '../utils/cx'
import { parseIntSafe } from '../utils/number'
import shared from '../styles/shared.module.css'
import s from './StockFormPage.module.css'

const EMPTY_FORM = { name: '', group: '' }
// `crypto.randomUUID` requires a secure context (HTTPS or localhost).
// Production may run over plain HTTP on a LAN (Synology) and e2e hits
// `host.docker.internal`, where the API is unavailable. The fallback
// is good enough for a local list key — it is never persisted.
let nextBatchUid = 0
const newBatchUid = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  nextBatchUid += 1
  return `batch-${Date.now()}-${nextBatchUid}`
}
const EMPTY_BATCH = () => ({ uid: newBatchUid(), quantity: '', expiry_date: '', lot_number: '' })

export default function StockFormPage() {
  const { id } = useParams()
  const isEditing = Boolean(id)
  const stockId = isEditing ? Number(id) : null
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { showToast } = useToast()

  const { data: stock, isLoading: stockLoading, isError: stockError } = useStock(stockId)
  const { data: groups = [] } = useStockGroups()
  const { data: contacts = [] } = useContacts()
  const createStock = useCreateStock()
  const updateStock = useUpdateStock()
  const createStockLot = useCreateStockLot()
  const reachable = useServerReachable()

  const [form, setForm] = useState(EMPTY_FORM)
  const [sharedWith, setSharedWith] = useState([])
  const [batches, setBatches] = useState([])
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isEditing || !stock) return
    setForm({ name: stock.name ?? '', group: stock.group ?? '' })
    setSharedWith(Array.isArray(stock.shared_with) ? stock.shared_with : [])
  }, [isEditing, stock])

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const addBatch = () => setBatches((prev) => [...prev, EMPTY_BATCH()])
  const removeBatch = (uid) => setBatches((prev) => prev.filter((b) => b.uid !== uid))
  const updateBatch = (uid, key, value) =>
    setBatches((prev) => prev.map((b) => (b.uid === uid ? { ...b, [key]: value } : b)))

  const validate = () => {
    const err = {}
    if (!form.name.trim()) err.name = t('stockForm.errorNameRequired')
    if (!isEditing && batches.length > 0) {
      const badIndex = batches.findIndex((b) => parseIntSafe(b.quantity, -1) <= 0)
      if (badIndex !== -1) err.batches = t('stockForm.errorLotQuantity')
    }
    return err
  }

  const groupValue = form.group === '' || form.group === null ? null : Number(form.group)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validate()
    if (Object.keys(err).length) {
      setErrors(err)
      return
    }
    setErrors({})
    setSubmitting(true)

    try {
      if (isEditing) {
        await updateStock.mutateAsync({
          stockId,
          patch: { name: form.name.trim(), group: groupValue, shared_with: sharedWith },
          updatedAt: stock?.updated_at,
        })
        navigate(`/inventory/${stockId}`)
        return
      }

      const created = await createStock.mutateAsync({ name: form.name.trim(), group: groupValue })
      const newStockId = created?.id
      if (!newStockId) {
        setErrors({ submit: t('common.actionError') })
        return
      }

      // Create all requested batches in parallel. If any fails the stock
      // stays created — user can retry the missing batches from detail.
      if (batches.length > 0) {
        const results = await Promise.allSettled(
          batches.map((b) =>
            createStockLot.mutateAsync({
              stockId: newStockId,
              quantity: parseIntSafe(b.quantity),
              expiryDate: b.expiry_date || null,
              lotNumber: b.lot_number || '',
            }),
          ),
        )
        const failed = results.filter((r) => r.status === 'rejected').length
        if (failed > 0) {
          // Offline rejections never land here — useCreateStockLot queues
          // them transparently — so the detail copy is always the generic one.
          showToast({
            type: 'error',
            message: t('stockForm.batchesPartial', { failed, detail: t('common.actionError') }),
          })
        }
      }

      if (sharedWith.length > 0) {
        try {
          await updateStock.mutateAsync({
            stockId: newStockId,
            patch: { shared_with: sharedWith },
            updatedAt: created.updated_at,
          })
        } catch {
          // Non-fatal: stock exists, share can be tweaked from edit.
        }
      }

      navigate(`/inventory/${newStockId}`)
    } catch (err) {
      const message = err instanceof OfflineError ? t('offline.actionUnavailable') : t('common.actionError')
      setErrors({ submit: message })
    } finally {
      setSubmitting(false)
    }
  }

  if (isEditing && stockLoading) return <div className={shared.spinner} />
  if (isEditing && stockError) return <p className={shared.muted}>{t('common.error')}</p>

  const disabledCreate = !isEditing && !reachable

  return (
    <div className={s.container}>
      <div className={s.topBar}>
        <button type="button" className={s.back} onClick={() => navigate(-1)}>
          {t('common.backToInventory')}
        </button>
        <h1 className={shared.pageTitle}>{isEditing ? t('stockForm.editTitle') : t('stockForm.newTitle')}</h1>
      </div>

      <form onSubmit={handleSubmit} className={s.form} noValidate>
        <section className={shared.formSection}>
          <label className={s.field}>
            <span className={s.fieldLabel}>{t('stockForm.nameLabel')}</span>
            <input
              className={shared.input}
              value={form.name}
              onChange={field('name')}
              placeholder={t('stockForm.namePlaceholder')}
              autoFocus
            />
            {errors.name && <span className={shared.error}>{errors.name}</span>}
          </label>

          <label className={s.field}>
            <span className={s.fieldLabel}>{t('stockForm.groupLabel')}</span>
            <select className={shared.input} value={form.group ?? ''} onChange={field('group')}>
              <option value="">{t('stockForm.groupNone')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </section>

        <ShareWithSection
          value={sharedWith}
          onChange={setSharedWith}
          contacts={contacts}
          label={t('stockForm.sharedLabel')}
        />

        {!isEditing && (
          <section className={shared.formSection}>
            <div className={shared.formSectionHeader}>
              <span className={shared.formSectionTitle}>{t('stockForm.batchesLabel')}</span>
              <button
                type="button"
                className={cx(shared.btn, shared.btnSecondary, shared.formSecondaryBtn)}
                onClick={addBatch}
              >
                <Icon name="plus" size="sm" />
                <span>{t('stockForm.addBatch')}</span>
              </button>
            </div>
            {batches.length === 0 ? (
              <p className={shared.helpText}>{t('stockForm.batchesEmpty')}</p>
            ) : (
              <ul className={s.batchesList}>
                {batches.map((b, idx) => (
                  <li key={b.uid} className={s.batchRow}>
                    <div className={s.batchFields}>
                      <label className={s.batchField}>
                        <span className={s.batchFieldLabel}>{t('stockForm.lotQuantity')}</span>
                        <input
                          className={cx(shared.input, s.batchInputQty)}
                          type="number"
                          min={1}
                          value={b.quantity}
                          onChange={(e) => updateBatch(b.uid, 'quantity', e.target.value)}
                          aria-label={t('stockForm.batchQuantityAria', { index: idx + 1 })}
                        />
                      </label>
                      <label className={s.batchField}>
                        <span className={s.batchFieldLabel}>{t('stockForm.lotExpiry')}</span>
                        <input
                          className={shared.input}
                          type="date"
                          value={b.expiry_date}
                          onChange={(e) => updateBatch(b.uid, 'expiry_date', e.target.value)}
                          aria-label={t('stockForm.batchExpiryAria', { index: idx + 1 })}
                        />
                      </label>
                      <label className={cx(s.batchField, s.batchFieldFlex)}>
                        <span className={s.batchFieldLabel}>{t('stockForm.lotNumber')}</span>
                        <input
                          className={shared.input}
                          type="text"
                          value={b.lot_number}
                          onChange={(e) => updateBatch(b.uid, 'lot_number', e.target.value)}
                          aria-label={t('stockForm.batchLotAria', { index: idx + 1 })}
                        />
                      </label>
                    </div>
                    <button
                      type="button"
                      className={cx(shared.btnIcon, shared.btnIconDelete, s.batchRemove)}
                      onClick={() => removeBatch(b.uid)}
                      aria-label={t('stockForm.removeBatch', { index: idx + 1 })}
                      title={t('stockForm.removeBatch', { index: idx + 1 })}
                    >
                      <Icon name="x" size="sm" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {errors.batches && <p className={shared.error}>{errors.batches}</p>}
          </section>
        )}

        {errors.submit && <p className={shared.error}>{errors.submit}</p>}
        {disabledCreate && <p className={shared.helpText}>{t('offline.requiresConnection')}</p>}

        <div className={shared.formFooter}>
          <button
            type="submit"
            className={cx(shared.btn, shared.btnPrimary, shared.formSecondaryBtn, s.submitBtn)}
            disabled={submitting || disabledCreate}
            title={disabledCreate ? t('offline.requiresConnection') : undefined}
          >
            {submitting ? t('stockForm.saving') : isEditing ? t('stockForm.submitEdit') : t('stockForm.submitCreate')}
          </button>
          <button
            type="button"
            className={cx(shared.btn, shared.btnSecondary, shared.formSecondaryBtn)}
            onClick={() => navigate(-1)}
          >
            {t('stockForm.cancel')}
          </button>
        </div>
      </form>
    </div>
  )
}
