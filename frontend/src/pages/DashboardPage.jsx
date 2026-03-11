import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import RoutineCard from '../components/RoutineCard'
import LotSelectionModal from '../components/LotSelectionModal'
import ShareModal from '../components/ShareModal'
import shared from '../styles/shared.module.css'
import s from './DashboardPage.module.css'

export default function DashboardPage() {
  const [data, setData] = useState({ due: [], upcoming: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [completing, setCompleting] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [lotModal, setLotModal] = useState(null) // null | { routine, lots }
  const [shareRoutineId, setShareRoutineId] = useState(null)
  const [contacts, setContacts] = useState([])
  const { t } = useTranslation()

  const fetchDashboard = useCallback(async () => {
    const res = await api.get('/dashboard/')
    if (!res.ok) throw new Error()
    setData(await res.json())
  }, [])

  useEffect(() => {
    fetchDashboard()
      .catch(() => setError(true))
      .finally(() => setLoading(false))
    api
      .get('/auth/contacts/')
      .then((r) => r.json())
      .then(setContacts)
      .catch(() => {})
  }, [fetchDashboard])

  const markDone = async (routineId) => {
    const routine = [...data.due, ...data.upcoming].find((r) => r.id === routineId)
    if (routine?.requires_lot_selection) {
      setCompleting(routineId)
      setActionError(null)
      try {
        const res = await api.get(`/routines/${routineId}/lots-for-selection/`)
        if (!res.ok) throw new Error()
        const lots = await res.json()
        setLotModal({ routine, lots })
      } catch {
        setActionError(t('common.actionError'))
      } finally {
        setCompleting(null)
      }
      return
    }

    setCompleting(routineId)
    setActionError(null)
    try {
      const res = await api.post(`/routines/${routineId}/log/`, {})
      if (!res.ok) throw new Error()
      await fetchDashboard()
    } catch {
      setActionError(t('common.actionError'))
    } finally {
      setCompleting(null)
    }
  }

  const handleLotConfirm = async (lotSelections) => {
    const routineId = lotModal.routine.id
    setLotModal(null)
    setCompleting(routineId)
    setActionError(null)
    try {
      const res = await api.post(`/routines/${routineId}/log/`, { lot_selections: lotSelections })
      if (!res.ok) throw new Error()
      await fetchDashboard()
    } catch {
      setActionError(t('common.actionError'))
    } finally {
      setCompleting(null)
    }
  }

  const handleToggleShare = async (userId) => {
    if (!shareRoutineId) return
    const routine = [...data.due, ...data.upcoming].find((r) => r.id === shareRoutineId)
    if (!routine) return
    const current = routine.shared_with || []
    const newShared = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    await api.patch(`/routines/${shareRoutineId}/`, { shared_with: newShared })
    await fetchDashboard()
  }

  if (loading) return <div className={shared.spinner} data-testid="spinner" />
  if (error) return <p className={shared.muted}>{t('common.error')}</p>

  return (
    <div>
      {actionError && <p className={shared.error}>{actionError}</p>}
      <div className={shared.topBar}>
        <Link to="/routines/new" className={s.newLink}>
          {t('dashboard.newRoutine')}
        </Link>
      </div>
      <Section
        title={t('dashboard.today')}
        routines={data.due}
        onMarkDone={markDone}
        completing={completing}
        emptyMessage={t('dashboard.empty')}
        contacts={contacts}
        onShare={setShareRoutineId}
      />
      <Section
        title={t('dashboard.upcoming')}
        routines={data.upcoming}
        onMarkDone={markDone}
        completing={completing}
        contacts={contacts}
        onShare={setShareRoutineId}
      />
      {lotModal && (
        <LotSelectionModal
          routine={lotModal.routine}
          lots={lotModal.lots}
          onConfirm={handleLotConfirm}
          onCancel={() => setLotModal(null)}
        />
      )}
      {shareRoutineId &&
        (() => {
          const shareRoutine = [...data.due, ...data.upcoming].find((r) => r.id === shareRoutineId)
          return shareRoutine ? (
            <ShareModal
              contacts={contacts}
              sharedWith={shareRoutine.shared_with}
              onToggle={handleToggleShare}
              onClose={() => setShareRoutineId(null)}
            />
          ) : null
        })()}
    </div>
  )
}

function Section({ title, routines, onMarkDone, completing, emptyMessage, contacts, onShare }) {
  return (
    <section className={s.section}>
      <h2 className={shared.sectionTitle}>{title}</h2>
      {routines.length === 0 && emptyMessage ? (
        <p className={shared.muted}>{emptyMessage}</p>
      ) : routines.length > 0 ? (
        <div className={s.list}>
          {routines.map((r) => (
            <RoutineCard
              key={r.id}
              routine={r}
              onMarkDone={onMarkDone}
              completing={completing === r.id}
              contacts={contacts}
              onShare={onShare}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}
