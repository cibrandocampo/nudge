import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EmptyCard from '../components/EmptyCard'
import Icon from '../components/Icon'
import LotConsumeModal from '../components/LotConsumeModal'
import RoutineCard from '../components/RoutineCard'
import Spinner from '../components/Spinner'
import { useToast } from '../components/useToast'
import { useRoutines } from '../hooks/useRoutines'
import { useDashboard } from '../hooks/useDashboard'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockList } from '../hooks/useStock'
import { useLogRoutine } from '../hooks/mutations/useLogRoutine'
import { useUndoLogRoutine } from '../hooks/mutations/useUndoLogRoutine'
import cx from '../utils/cx'
import { errorToastMessage } from '../utils/errors'
import { findCachedStock, lotsForSelection } from '../utils/lotsForSelection'
import buttons from '../styles/buttons.module.css'
import layout from '../styles/layout.module.css'
import s from './DashboardPage.module.css'

// How long a just-completed routine stays highlighted in its new place. The
// card's flash animation lasts the same (`--highlight-ms`).
export const HIGHLIGHT_MS = 1200

export default function DashboardPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { data, isLoading, isError } = useDashboard()
  const reachable = useServerReachable()
  const queryClient = useQueryClient()
  // Keep full routine list warm so the router detail page loads instantly.
  // Also feeds the dashboard's empty-state decision: the server's `due` +
  // `upcoming` lists may be both empty because the user just completed a
  // routine (positive "all caught up") or because they've never created
  // one (suggest creating) — we tell them apart from the full list count.
  const { data: allRoutinesData = [] } = useRoutines()
  // Keep the stock cache warm so the lot-selection modal can derive its
  // list from `['stock', id].lots` without an extra HTTP call — and still
  // work offline if the user hasn't visited the inventory page yet.
  useStockList()

  const [completing, setCompleting] = useState(null)
  const [lotModal, setLotModal] = useState(null)
  const [highlightId, setHighlightId] = useState(null)

  useEffect(() => {
    if (highlightId == null) return undefined
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [highlightId])

  const logMutation = useLogRoutine()
  const undoLogMutation = useUndoLogRoutine()

  const dueList = data?.due ?? []
  const upcomingList = data?.upcoming ?? []
  const allRoutines = [...dueList, ...upcomingList]

  const runLog = async (routineId, { lotSelections, revert } = {}) => {
    setCompleting(routineId)
    // Where the routine was found decides how a discarded offline entry is
    // undone: an upcoming one gets its previous dates back (useLogRoutine).
    const upcomingRoutine = upcomingList.find((r) => r.id === routineId)
    const from = upcomingRoutine ? 'upcoming' : 'due'
    const previous = upcomingRoutine && {
      next_due_at: upcomingRoutine.next_due_at,
      last_entry_at: upcomingRoutine.last_entry_at ?? null,
      hours_until_due: upcomingRoutine.hours_until_due,
    }
    // The optimistic update moves the routine into Upcoming right away:
    // highlight it there so it does not look deleted.
    setHighlightId(routineId)
    try {
      const routineName = allRoutines.find((r) => r.id === routineId)?.name
      const result = await logMutation.mutateAsync({ routineId, routineName, lotSelections, from, previous })
      if (result?.__queued) {
        // No server entry yet, so no Undo: the queued entry can still be
        // discarded from the PendingBadge panel.
        showToast({ type: 'info', message: t('card.markedDoneQueued') })
      }
      if (result && result.id) {
        const entryId = result.id
        showToast({
          type: 'success',
          message: t('card.markedDone'),
          duration: 5000,
          action: {
            label: t('card.undo'),
            onClick: () => {
              undoLogMutation.mutate({ entryId, routineName })
            },
          },
        })
      }
    } catch (err) {
      // The optimistic move is rolled back by the mutation; the card that
      // played its exit comes back to rest.
      setHighlightId(null)
      revert?.()
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    } finally {
      setCompleting(null)
    }
  }

  const markDone = async (routineId, { revert } = {}) => {
    const routine = allRoutines.find((r) => r.id === routineId)
    if (routine?.requires_lot_selection) {
      // The card already played its exit; nothing is logged until the user
      // picks lots, so bring it back while the picker is open.
      revert?.()
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
    await runLog(routineId, { revert })
  }

  const handleLotConfirm = async (lotSelections) => {
    const routineId = lotModal.routine.id
    setLotModal(null)
    await runLog(routineId, { lotSelections })
  }

  // Render the persisted snapshot even when a refetch fails or while a
  // background refetch is in flight — the global OfflineBanner conveys
  // staleness, and an empty error / loading state is worse UX than
  // last-known-good data the user can still act on.
  if (isLoading && !data) return <Spinner />
  if (isError && !data) return <p className={layout.muted}>{t('common.error')}</p>

  return (
    <div>
      <div className={layout.topBar}>
        <h1 className={layout.pageTitle}>{t('dashboard.title')}</h1>
        {reachable ? (
          <Link to="/routines/new" className={buttons.btnAdd} aria-label={t('dashboard.newRoutine')}>
            <Icon name="plus" />
          </Link>
        ) : (
          <button
            type="button"
            className={cx(buttons.btnAdd, buttons.disabled)}
            onClick={() => showToast({ type: 'error', message: t('offline.pageUnavailable') })}
            aria-disabled="true"
            aria-label={t('dashboard.newRoutine')}
            title={t('offline.pageUnavailable')}
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
        highlightId={highlightId}
        empty={
          allRoutinesData.length === 0 ? (
            <EmptyCard title={t('dashboard.noRoutinesTitle')} message={t('dashboard.noRoutinesBody')} />
          ) : (
            <EmptyCard title={t('dashboard.empty')} message={t('dashboard.emptyBody')} />
          )
        }
      />
      <Section
        title={t('dashboard.upcoming')}
        routines={upcomingList}
        onMarkDone={markDone}
        completing={completing}
        highlightId={highlightId}
      />
      {lotModal && (
        <LotConsumeModal
          groups={lotModal.lots}
          needed={lotModal.routine.stock_usage}
          onConfirm={handleLotConfirm}
          onCancel={() => setLotModal(null)}
        />
      )}
    </div>
  )
}

function Section({ title, routines, onMarkDone, completing, highlightId, empty }) {
  return (
    <section className={s.section}>
      <h2 className={layout.sectionTitle}>{title}</h2>
      {routines.length === 0 && empty
        ? empty
        : routines.length > 0 && (
            <div className={s.list}>
              {routines.map((r) => (
                <RoutineCard
                  key={r.id}
                  routine={r}
                  onMarkDone={onMarkDone}
                  completing={completing === r.id}
                  highlighted={highlightId === r.id}
                />
              ))}
            </div>
          )}
    </section>
  )
}
