import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../components/ConfirmModal'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import LotSelectionModal from '../components/LotSelectionModal'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useRoutine, useRoutineEntries } from '../hooks/useRoutines'
import { useStockList } from '../hooks/useStock'
import { useDeleteRoutine } from '../hooks/mutations/useDeleteRoutine'
import { useLogRoutine } from '../hooks/mutations/useLogRoutine'
import { useUpdateRoutine } from '../hooks/mutations/useUpdateRoutine'
import cx from '../utils/cx'
import { formatAbsoluteDate, formatRelativeTime } from '../utils/time'
import { groupEntriesByDate } from '../utils/historyGroups'
import { findCachedStock, lotsForSelection } from '../utils/lotsForSelection'
import shared from '../styles/shared.module.css'
import s from './RoutineDetailPage.module.css'

export default function RoutineDetailPage() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { showToast } = useToast()

  const { data: routine, isLoading: routineLoading, isError: routineError, error: routineErr } = useRoutine(id)
  const { data: entries = [] } = useRoutineEntries(id)
  const logMutation = useLogRoutine()
  const updateMutation = useUpdateRoutine()
  const deleteMutation = useDeleteRoutine()
  const queryClient = useQueryClient()
  // Keep the stock cache warm so the lot selection modal derives its list
  // offline from `['stock', id].lots` without hitting the network.
  useStockList()

  const [completing, setCompleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAdvanceConfirm, setShowAdvanceConfirm] = useState(false)
  const [lotModal, setLotModal] = useState(null)

  const runLog = async (lotSelections) => {
    setCompleting(true)
    try {
      await logMutation.mutateAsync({ routineId: Number(id), routineName: routine?.name, lotSelections })
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    } finally {
      setCompleting(false)
    }
  }

  const markDone = async () => {
    if (routine?.requires_lot_selection) {
      const stock = findCachedStock(queryClient, routine?.stock)
      const lots = lotsForSelection(stock)
      if (lots.length === 0) {
        showToast({ type: 'error', message: t('common.actionError') })
        return
      }
      setLotModal({ lots })
      return
    }
    await runLog()
  }

  const handleLotConfirm = async (lotSelections) => {
    setLotModal(null)
    await runLog(lotSelections)
  }

  // Auto-log when opened from a push notification "Mark as done" action.
  // Depends on the query having loaded so `routine.is_due` is reliable.
  useEffect(() => {
    if (searchParams.get('action') === 'mark-done' && !routineLoading && routine?.is_due) {
      setSearchParams({}, { replace: true })
      markDone()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routineLoading])

  const toggleActive = async () => {
    try {
      await updateMutation.mutateAsync({
        routineId: Number(id),
        routineName: routine.name,
        patch: { is_active: !routine.is_active },
        updatedAt: routine.updated_at,
      })
    } catch {
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  const confirmDelete = async () => {
    try {
      await deleteMutation.mutateAsync({
        routineId: Number(id),
        routineName: routine.name,
        updatedAt: routine.updated_at,
      })
      navigate('/')
    } catch {
      setShowDeleteConfirm(false)
      showToast({ type: 'error', message: t('common.actionError') })
    }
  }

  if (routineLoading) return <div className={shared.spinner} data-testid="spinner" />
  if (routineError) {
    if (routineErr?.status === 404) return <p className={shared.muted}>{t('routine.detail.notFound')}</p>
    return <p className={shared.muted}>{t('common.error')}</p>
  }
  if (!routine) return <p className={shared.muted}>{t('routine.detail.notFound')}</p>

  const borderClass = !routine.is_due
    ? shared.cardBorderSuccess
    : routine.is_overdue
      ? shared.cardBorderDanger
      : shared.cardBorderWarning

  return (
    <div>
      <div className={shared.topBar}>
        <Link to="/" className={s.back}>
          {t('common.backToRoutines')}
        </Link>
        <div className={s.topActions}>
          <Link
            to={`/history?type=routines&routine=${routine.id}`}
            className={cx(shared.btnAdd, shared.btnAddSecondary)}
            aria-label={t('routine.detail.viewAll')}
            title={t('routine.detail.viewAll')}
          >
            <Icon name="history" />
          </Link>
          <button
            type="button"
            className={cx(shared.btnAdd, shared.btnAddSecondary)}
            onClick={toggleActive}
            aria-label={routine.is_active ? t('routine.detail.deactivate') : t('routine.detail.activate')}
            title={routine.is_active ? t('routine.detail.deactivate') : t('routine.detail.activate')}
          >
            <Icon name={routine.is_active ? 'pause' : 'play'} />
          </button>
          <button
            type="button"
            className={cx(shared.btnAdd, shared.btnAddDanger)}
            onClick={() => setShowDeleteConfirm(true)}
            aria-label={t('routine.detail.delete')}
            title={t('routine.detail.delete')}
          >
            <Icon name="trash" />
          </button>
          <Link
            to={`/routines/${id}/edit`}
            className={shared.btnAdd}
            aria-label={t('routine.detail.edit')}
            title={t('routine.detail.edit')}
          >
            <Icon name="pencil" />
          </Link>
        </div>
      </div>

      <h1 className={s.title}>
        {routine.name}
        <SyncStatusBadge resourceKey={`routine:${routine.id}`} />
      </h1>
      {routine.description && <p className={s.description}>{routine.description}</p>}

      <div className={cx(shared.card, borderClass, s.meta)}>
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
            {routine.next_due_at
              ? `${formatRelativeTime(routine.next_due_at)} · ${formatAbsoluteDate(routine.next_due_at)}`
              : t('time.dueNow')}
          </span>
        </div>
        {routine.stock_name && (
          <div className={s.metaRow}>
            <span className={s.metaLabel}>{t('routine.detail.stock')}</span>
            <span className={s.metaValue}>
              {t('routine.detail.stockUsage', {
                qty: routine.stock_quantity,
                name: routine.stock_name,
                usage: routine.stock_usage,
              })}
            </span>
          </div>
        )}
      </div>

      {routine.is_due && (
        <button
          className={cx(shared.btn, shared.btnPrimary, s.primaryAction, completing && shared.disabled)}
          onClick={markDone}
          disabled={completing}
        >
          {completing ? t('routine.detail.logging') : t('routine.detail.markDone')}
        </button>
      )}

      {!routine.is_due && routine.is_active && (
        <button
          className={cx(shared.btn, shared.btnPrimary, s.primaryAction, completing && shared.disabled)}
          onClick={() => setShowAdvanceConfirm(true)}
          disabled={completing}
        >
          {t('routine.detail.advance')}
        </button>
      )}

      {entries.length > 0 && (
        <section className={s.section}>
          <h3 className={shared.sectionTitle}>{t('routine.detail.recentHistory')}</h3>
          <div className={s.entryList}>
            {groupEntriesByDate(entries.map((e) => ({ ...e, _type: 'routine' }))).map(({ dateLabel, items }) => (
              <section key={dateLabel} className={s.dayGroup}>
                <p className={s.dayHeader}>{dateLabel}</p>
                <div className={s.dayList}>
                  {items.map((entry) => (
                    <HistoryEntryCard key={entry.id} entry={entry} showTitle={false} compact />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </section>
      )}

      {showDeleteConfirm && (
        <ConfirmModal
          message={t('routine.detail.confirmDelete', { name: routine.name })}
          onConfirm={confirmDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmLabel={t('routine.detail.delete')}
        />
      )}
      {showAdvanceConfirm && (
        <ConfirmModal
          message={t('routine.detail.advanceConfirm')}
          onConfirm={() => {
            setShowAdvanceConfirm(false)
            markDone()
          }}
          onCancel={() => setShowAdvanceConfirm(false)}
          confirmLabel={t('routine.detail.advance')}
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
