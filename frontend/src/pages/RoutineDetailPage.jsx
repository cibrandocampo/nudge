import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { formatRelativeTime, getLocale } from '../utils/time'
import cx from '../utils/cx'
import ConfirmModal from '../components/ConfirmModal'
import LotSelectionModal from '../components/LotSelectionModal'
import shared from '../styles/shared.module.css'
import s from './RoutineDetailPage.module.css'

export default function RoutineDetailPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [routine, setRoutine] = useState(null)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [lotModal, setLotModal] = useState(null) // null | { lots }

  const fetchData = async () => {
    const [rRes, eRes] = await Promise.all([api.get(`/routines/${id}/`), api.get(`/routines/${id}/entries/`)])
    if (rRes.ok) setRoutine(await rRes.json())
    if (eRes.ok) {
      const data = await eRes.json()
      setEntries((data.results ?? data).slice(0, 5))
    }
  }

  useEffect(() => {
    fetchData()
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-log when opened from a push notification "Mark as done" action
  useEffect(() => {
    if (searchParams.get('action') === 'mark-done' && !loading && routine?.is_due) {
      setSearchParams({}, { replace: true })
      markDone()
    }
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const markDone = async () => {
    if (routine?.requires_lot_selection) {
      setCompleting(true)
      setActionError(null)
      try {
        const res = await api.get(`/routines/${id}/lots-for-selection/`)
        if (!res.ok) throw new Error()
        const lots = await res.json()
        setLotModal({ lots })
      } catch {
        setActionError(t('common.actionError'))
      } finally {
        setCompleting(false)
      }
      return
    }

    setCompleting(true)
    setActionError(null)
    try {
      const res = await api.post(`/routines/${id}/log/`, {})
      if (!res.ok) throw new Error()
      await fetchData()
    } catch {
      setActionError(t('common.actionError'))
    } finally {
      setCompleting(false)
    }
  }

  const handleLotConfirm = async (lotSelections) => {
    setLotModal(null)
    setCompleting(true)
    setActionError(null)
    try {
      const res = await api.post(`/routines/${id}/log/`, { lot_selections: lotSelections })
      if (!res.ok) throw new Error()
      await fetchData()
    } catch {
      setActionError(t('common.actionError'))
    } finally {
      setCompleting(false)
    }
  }

  const toggleActive = async () => {
    setActionError(null)
    try {
      const res = await api.patch(`/routines/${id}/`, { is_active: !routine.is_active })
      if (!res.ok) throw new Error()
      await fetchData()
    } catch {
      setActionError(t('common.actionError'))
    }
  }

  const deleteRoutine = () => setShowDeleteConfirm(true)

  const confirmDelete = async () => {
    try {
      const res = await api.delete(`/routines/${id}/`)
      if (!res.ok && res.status !== 204) throw new Error()
      navigate('/')
    } catch {
      setShowDeleteConfirm(false)
      setActionError(t('common.actionError'))
    }
  }

  if (loading) return <p className={shared.muted}>{t('common.loading')}</p>
  if (error) return <p className={shared.muted}>{t('common.error')}</p>
  if (!routine) return <p className={shared.muted}>{t('routine.detail.notFound')}</p>

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <Link to="/" className={s.back}>
          {t('routine.detail.back')}
        </Link>
        <Link to={`/routines/${id}/edit`} className={s.edit}>
          {t('routine.detail.edit')}
        </Link>
      </div>

      {actionError && <p className={shared.error}>{actionError}</p>}
      <h1 className={s.title}>{routine.name}</h1>
      {routine.description && <p className={s.description}>{routine.description}</p>}

      <div className={s.meta}>
        <div className={s.metaRow}>
          <span className={s.metaLabel}>{t('routine.detail.interval')}</span>
          <span className={s.metaValue}>{formatInterval(routine.interval_hours, t)}</span>
        </div>
        <div className={s.metaRow}>
          <span className={s.metaLabel}>{t('routine.detail.status')}</span>
          <span className={s.metaValue}>
            {routine.is_active ? t('routine.detail.active') : t('routine.detail.inactive')}
          </span>
        </div>
        <div className={s.metaRow}>
          <span className={s.metaLabel}>{t('routine.detail.nextDue')}</span>
          <span className={s.metaValue}>
            {routine.next_due_at ? formatRelativeTime(routine.next_due_at) : t('time.dueNow')}
          </span>
        </div>
        {routine.stock_name && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>{t('routine.detail.stock')}</span>
            <span
              className={s.metaValue}
            >{`${routine.stock_quantity} × ${routine.stock_name} (uses ${routine.stock_usage} per log)`}</span>
          </div>
        )}
      </div>

      {routine.is_due && (
        <button className={cx(s.doneBtn, completing && shared.disabled)} onClick={markDone} disabled={completing}>
          {completing ? t('routine.detail.logging') : t('routine.detail.markDone')}
        </button>
      )}

      {entries.length > 0 && (
        <section className={s.section}>
          <h3 className={shared.sectionTitle}>{t('routine.detail.recentHistory')}</h3>
          <div className={s.entryList}>
            {entries.map((e) => (
              <div key={e.id} className={s.entry}>
                <span className={s.entryDate}>{new Date(e.created_at).toLocaleString(getLocale())}</span>
                {e.notes && <span className={s.notes}>{e.notes}</span>}
              </div>
            ))}
          </div>
          <Link to="/history" className={s.viewAll}>
            {t('routine.detail.viewAll')}
          </Link>
        </section>
      )}

      <div className={s.actions}>
        <button className={s.toggleBtn} onClick={toggleActive}>
          {routine.is_active ? t('routine.detail.deactivate') : t('routine.detail.activate')}
        </button>
        <button className={s.deleteBtn} onClick={deleteRoutine}>
          {t('routine.detail.delete')}
        </button>
      </div>

      {showDeleteConfirm && (
        <ConfirmModal
          message={t('routine.detail.confirmDelete', { name: routine.name })}
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmLabel={t('routine.detail.delete')}
        />
      )}
      {lotModal && (
        <LotSelectionModal
          routine={routine}
          lots={lotModal.lots}
          onConfirm={handleLotConfirm}
          onCancel={() => setLotModal(null)}
        />
      )}
    </div>
  )
}

function formatInterval(hours, t) {
  if (hours % 8760 === 0) return t('routine.interval.years', { count: hours / 8760 })
  if (hours % 720 === 0) return t('routine.interval.months', { count: hours / 720 })
  if (hours % 168 === 0) return t('routine.interval.weeks', { count: hours / 168 })
  if (hours % 24 === 0) return t('routine.interval.days', { count: hours / 24 })
  return t('routine.interval.hours', { count: hours })
}
