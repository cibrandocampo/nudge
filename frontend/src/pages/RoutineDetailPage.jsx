import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../components/ConfirmModal'
import HistoryEntryCard from '../components/HistoryEntryCard'
import Icon from '../components/Icon'
import LotSelectionModal from '../components/LotSelectionModal'
import QueryHandler from '../components/QueryHandler'
import SharedWithChips from '../components/SharedWithChips'
import SyncStatusBadge from '../components/SyncStatusBadge'
import { useToast } from '../components/useToast'
import { useQueueEntries } from '../hooks/useQueueEntries'
import { useRoutine, useRoutineEntries } from '../hooks/useRoutines'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockList } from '../hooks/useStock'
import { useDeleteRoutine } from '../hooks/mutations/useDeleteRoutine'
import { useLogRoutine } from '../hooks/mutations/useLogRoutine'
import { useUpdateRoutine } from '../hooks/mutations/useUpdateRoutine'
import { useAuth } from '../contexts/AuthContext'
import cx from '../utils/cx'
import { avatarInitial } from '../utils/displayName'
import { errorToastMessage } from '../utils/errors'
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
  const { user } = useAuth()

  const { data: routine, isLoading: routineLoading, isError: routineError, error: routineErr } = useRoutine(id)
  const { data: entries = [] } = useRoutineEntries(id)
  const logMutation = useLogRoutine()
  const updateMutation = useUpdateRoutine()
  const deleteMutation = useDeleteRoutine()
  const queryClient = useQueryClient()
  const reachable = useServerReachable()
  const queueEntries = useQueueEntries()
  // A queued ``logRoutine`` for THIS routine means the stock decrement is
  // still pending on the server. Detect via endpoint suffix because
  // resourceKey alone (``routine:N``) also matches rename/delete entries.
  const hasPendingLog = queueEntries.some(
    (e) => e.resourceKey === `routine:${Number(id)}` && typeof e.endpoint === 'string' && e.endpoint.endsWith('/log/'),
  )
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
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
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
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
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
    } catch (err) {
      setShowDeleteConfirm(false)
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  // Stock-depleted escalation: a routine that can't be logged because the
  // linked stock is empty surfaces in red even when not due yet. Mirrors
  // RoutineCard.statusTokens so dashboard and detail page stay aligned.
  const stockAvailable = routine?.stock_quantity_available ?? routine?.stock_quantity ?? 0
  const routineStockDepleted =
    Boolean(routine?.stock_name) && Number(stockAvailable) < Number(routine?.stock_usage ?? 1)

  // Recipients besides the current viewer. The owner sees every recipient;
  // a non-owner recipient sees every other recipient. Used by the
  // "Shared with" section so the label means the same thing on both sides.
  const otherRecipients = (routine?.shared_with_details ?? []).filter(
    (c) => routine?.is_owner !== false || c.username !== user?.username,
  )
  const borderClass = routineStockDepleted
    ? shared.cardBorderDanger
    : !routine?.is_due
      ? shared.cardBorderSuccess
      : routine.is_overdue
        ? shared.cardBorderDanger
        : shared.cardBorderWarning

  // Severity contract is the post-T164 3-tier ('critical' | 'low' | 'ok').
  // Anything else (null when stock isn't cached yet) renders no dot.
  // Routine-driven escalation: if `routineStockDepleted` is true the dot is
  // red regardless of the stock-list cache. Without this, after a Mark-done
  // that empties the stock the routine query refreshes immediately
  // (`stock_quantity_available` drops to 0) but the `['stock']` cache may
  // still hold the previous severity ('low') for a few hundred ms — leaving
  // the dot orange while the rest of the row reads "0 × <stock>".
  const stockSeverity = findCachedStock(queryClient, routine?.stock)?.stock_severity
  const stockDotClass = routineStockDepleted
    ? shared.dotDanger
    : stockSeverity === 'critical'
      ? shared.dotDanger
      : stockSeverity === 'low'
        ? shared.dotWarning
        : stockSeverity === 'ok'
          ? shared.dotSuccess
          : null

  return (
    <QueryHandler
      isLoading={routineLoading}
      isError={routineError}
      error={routineErr}
      data={routine}
      notFound={!routineLoading && !routineError && !routine}
      notFoundKey="routine.detail.notFound"
    >
      {routine && (
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
              {routine.is_owner !== false && (
                <>
                  <button
                    type="button"
                    className={cx(shared.btnAdd, routine.is_active ? shared.btnAddDanger : shared.btnAddSuccess)}
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
                  <button
                    type="button"
                    className={cx(shared.btnAdd, !reachable && shared.disabled)}
                    onClick={() => {
                      if (!reachable) {
                        showToast({ type: 'error', message: t('offline.pageUnavailable') })
                        return
                      }
                      navigate(`/routines/${id}/edit`)
                    }}
                    aria-disabled={!reachable}
                    aria-label={t('routine.detail.edit')}
                    title={!reachable ? t('offline.pageUnavailable') : t('routine.detail.edit')}
                  >
                    <Icon name="pencil" />
                  </button>
                </>
              )}
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
              <span className={cx(s.metaValue, s.statusValue)}>
                <span className={cx(shared.dot, routine.is_active ? shared.dotSuccess : shared.dotDanger)} />
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
              <>
                <div className={s.metaRow}>
                  <span className={s.metaLabel}>{t('routine.detail.stock')}</span>
                  <span
                    className={cx(s.metaValue, s.statusValue, hasPendingLog && s.metaValuePending)}
                    data-testid="stock-row-value"
                  >
                    {stockDotClass && !hasPendingLog && (
                      <span className={cx(shared.dot, stockDotClass)} data-testid="stock-severity-dot" />
                    )}
                    {hasPendingLog && <Icon name="clock" size="sm" />}
                    {t('routine.detail.stockValue', {
                      qty: routine.stock_quantity,
                      name: routine.stock_name,
                    })}
                  </span>
                </div>
                {hasPendingLog && (
                  <div className={cx(s.metaRow, s.metaRowPending)}>
                    <span className={s.metaLabel} aria-hidden="true" />
                    <span className={cx(s.metaValue, s.metaPendingNote)}>{t('routine.detail.stockPendingSync')}</span>
                  </div>
                )}
                <div className={s.metaRow}>
                  <span className={s.metaLabel}>{t('routine.detail.perLog')}</span>
                  <span className={s.metaValue}>
                    {routine.stock_usage} {t('common.unit')}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Non-owner viewer: single card with the owner chip on the left
              and (if any) the other recipients on the right. Two distinct
              labels under one frame keeps the relationship clear without
              the visual noise of two stacked cards. */}
          {routine.is_owner === false && routine.owner_username && (
            <section className={cx(shared.formSection, s.sharedBlock)} data-testid="people-info">
              <div className={s.peopleSplit}>
                <div className={s.peopleColumn} data-testid="owner-info">
                  <span className={shared.formSectionTitle}>{t('sharing.owner')}</span>
                  <div className={shared.formChipsRow}>
                    <span className={shared.formChip}>
                      <span className={shared.formChipAvatar} aria-hidden="true">
                        {avatarInitial({ username: routine.owner_username })}
                      </span>
                      <span>{routine.owner_username}</span>
                    </span>
                  </div>
                </div>
                {otherRecipients.length > 0 && (
                  <div className={s.peopleColumn} data-testid="shared-with-info">
                    <span className={shared.formSectionTitle}>{t('sharing.sharedWith')}</span>
                    <SharedWithChips contacts={otherRecipients} />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Owner viewer keeps the standalone "Shared with" card — they
              don't need to see themselves chipped under "Propietario". */}
          {routine.is_owner !== false && otherRecipients.length > 0 && (
            <section className={cx(shared.formSection, s.sharedBlock)} data-testid="shared-with-info">
              <div className={shared.formSectionHeader}>
                <span className={shared.formSectionTitle}>{t('sharing.sharedWith')}</span>
              </div>
              <SharedWithChips contacts={otherRecipients} />
            </section>
          )}

          {routine.is_due && (
            <button
              className={cx(
                shared.btn,
                shared.btnPrimary,
                s.primaryAction,
                (completing || routineStockDepleted) && shared.disabled,
              )}
              onClick={() => {
                if (routineStockDepleted) {
                  showToast({ type: 'error', message: t('routine.detail.noStockToast') })
                  return
                }
                markDone()
              }}
              disabled={completing}
              aria-disabled={routineStockDepleted ? 'true' : undefined}
              title={routineStockDepleted ? t('routine.detail.noStockToast') : undefined}
            >
              {completing ? t('routine.detail.logging') : t('routine.detail.markDone')}
            </button>
          )}

          {!routine.is_due && routine.is_active && (
            <button
              className={cx(
                shared.btn,
                shared.btnPrimary,
                s.primaryAction,
                (completing || routineStockDepleted) && shared.disabled,
              )}
              onClick={() => {
                if (routineStockDepleted) {
                  showToast({ type: 'error', message: t('routine.detail.noStockToast') })
                  return
                }
                setShowAdvanceConfirm(true)
              }}
              disabled={completing}
              aria-disabled={routineStockDepleted ? 'true' : undefined}
              title={routineStockDepleted ? t('routine.detail.noStockToast') : undefined}
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
      )}
    </QueryHandler>
  )
}

function formatInterval(hours, t) {
  if (hours % 8760 === 0) return t('routine.interval.years', { count: hours / 8760 })
  if (hours % 720 === 0) return t('routine.interval.months', { count: hours / 720 })
  if (hours % 168 === 0) return t('routine.interval.weeks', { count: hours / 168 })
  if (hours % 24 === 0) return t('routine.interval.days', { count: hours / 24 })
  return t('routine.interval.hours', { count: hours })
}
