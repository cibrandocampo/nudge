import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from '../components/Icon'
import LotSelectionModal from '../components/LotSelectionModal'
import RoutineCard from '../components/RoutineCard'
import ShareModal from '../components/ShareModal'
import { useToast } from '../components/useToast'
import { useRoutines } from '../hooks/useRoutines'
import { useContacts } from '../hooks/useContacts'
import { useDashboard } from '../hooks/useDashboard'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockList } from '../hooks/useStock'
import { useLogRoutine } from '../hooks/mutations/useLogRoutine'
import { useUndoLogRoutine } from '../hooks/mutations/useUndoLogRoutine'
import { useUpdateRoutine } from '../hooks/mutations/useUpdateRoutine'
import cx from '../utils/cx'
import { findCachedStock, lotsForSelection } from '../utils/lotsForSelection'
import shared from '../styles/shared.module.css'
import s from './DashboardPage.module.css'

export default function DashboardPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { data, isLoading, isError } = useDashboard()
  const { data: contacts = [] } = useContacts()
  const reachable = useServerReachable()
  const queryClient = useQueryClient()
  // Keep full routine list warm so the router detail page loads instantly.
  useRoutines()
  // Keep the stock cache warm so the lot-selection modal can derive its
  // list from `['stock', id].lots` without an extra HTTP call — and still
  // work offline if the user hasn't visited the inventory page yet.
  useStockList()

  const [completing, setCompleting] = useState(null)
  const [lotModal, setLotModal] = useState(null)
  const [shareRoutineId, setShareRoutineId] = useState(null)

  const logMutation = useLogRoutine()
  const undoLogMutation = useUndoLogRoutine()
  const updateMutation = useUpdateRoutine()

  const dueList = data?.due ?? []
  const upcomingList = data?.upcoming ?? []
  const allRoutines = [...dueList, ...upcomingList]

  const runLog = async (routineId, lotSelections) => {
    setCompleting(routineId)
    try {
      const result = await logMutation.mutateAsync({ routineId, lotSelections })
      // `result.__queued` means the mutation was enqueued offline (no
      // entry id yet). Skip the Undo toast in that case — the user can
      // still discard the queued entry from the PendingBadge panel.
      if (result && result.id) {
        const entryId = result.id
        showToast({
          type: 'success',
          message: t('card.markedDone'),
          duration: 5000,
          action: {
            label: t('card.undo'),
            onClick: () => {
              undoLogMutation.mutate({ entryId })
            },
          },
        })
      }
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    } finally {
      setCompleting(null)
    }
  }

  const markDone = async (routineId) => {
    const routine = allRoutines.find((r) => r.id === routineId)
    if (routine?.requires_lot_selection) {
      // Derive the selection list from the already-cached stock. Works
      // offline as long as the stock has been fetched at least once (the
      // `useStockList()` warm above seeds it on dashboard mount).
      const stock = findCachedStock(queryClient, routine.stock)
      const lots = lotsForSelection(stock)
      if (lots.length === 0) {
        showToast({ type: 'error', message: t('common.actionError') })
        return
      }
      setLotModal({ routine, lots })
      return
    }
    await runLog(routineId)
  }

  const handleLotConfirm = async (lotSelections) => {
    const routineId = lotModal.routine.id
    setLotModal(null)
    await runLog(routineId, lotSelections)
  }

  const handleToggleShare = async (userId) => {
    // ShareModal is only mounted when shareRoutineId is set and the routine
    // exists in allRoutines, so `routine` can only be missing if the routine
    // was removed between the modal opening and the toggle firing.
    const routine = allRoutines.find((r) => r.id === shareRoutineId)
    if (!routine) return
    const current = routine.shared_with || []
    const newShared = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    try {
      await updateMutation.mutateAsync({
        routineId: shareRoutineId,
        patch: { shared_with: newShared },
        updatedAt: routine.updated_at,
      })
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  if (isLoading) return <div className={shared.spinner} data-testid="spinner" />
  if (isError) return <p className={shared.muted}>{t('common.error')}</p>

  return (
    <div>
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('dashboard.title')}</h1>
        {reachable ? (
          <Link to="/routines/new" className={shared.btnAdd} aria-label={t('dashboard.newRoutine')}>
            <Icon name="plus" />
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className={cx(shared.btnAdd, shared.disabled)}
            aria-label={t('dashboard.newRoutine')}
            title={t('offline.requiresConnection')}
          >
            <Icon name="plus" />
          </button>
        )}
      </div>
      <Section
        title={t('dashboard.today')}
        routines={dueList}
        onMarkDone={markDone}
        completing={completing}
        emptyMessage={t('dashboard.empty')}
        contacts={contacts}
        onShare={setShareRoutineId}
      />
      <Section
        title={t('dashboard.upcoming')}
        routines={upcomingList}
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
          const shareRoutine = allRoutines.find((r) => r.id === shareRoutineId)
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
