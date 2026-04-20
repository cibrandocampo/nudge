import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DateRangePicker from '../components/DateRangePicker'
import Icon from '../components/Icon'
import { useEntries, useStockConsumptions } from '../hooks/useEntries'
import { useRoutines } from '../hooks/useRoutines'
import { useStockList } from '../hooks/useStock'
import { useUpdateConsumption } from '../hooks/mutations/useUpdateConsumption'
import { useUpdateEntry } from '../hooks/mutations/useUpdateEntry'
import cx from '../utils/cx'
import { getLocale } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './HistoryPage.module.css'

function defaultDateFrom() {
  const d = new Date()
  d.setDate(d.getDate() - 15)
  return d.toISOString().slice(0, 10)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function HistoryPage() {
  const { t } = useTranslation()

  const [typeFilter, setTypeFilter] = useState('all')
  const [routineFilter, setRoutineFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(todayStr)
  const [editingNote, setEditingNote] = useState(null)
  const [savedNote, setSavedNote] = useState(null)

  const { data: routines = [] } = useRoutines()
  const { data: stocks = [] } = useStockList()

  const entriesFilters = useMemo(
    () => ({
      routine: routineFilter || undefined,
      dateFrom,
      dateTo,
      enabled: typeFilter !== 'consumptions',
    }),
    [routineFilter, dateFrom, dateTo, typeFilter],
  )
  const consumptionFilters = useMemo(
    () => ({
      stock: stockFilter || undefined,
      dateFrom,
      dateTo,
      enabled: typeFilter !== 'routines',
    }),
    [stockFilter, dateFrom, dateTo, typeFilter],
  )

  const entriesQuery = useEntries(entriesFilters)
  const consumptionsQuery = useStockConsumptions(consumptionFilters)

  const updateEntry = useUpdateEntry()
  const updateConsumption = useUpdateConsumption()

  const entries = entriesQuery.data?.pages.flatMap((p) => p.items) ?? []
  const consumptions = consumptionsQuery.data ?? []

  const loading =
    (entriesFilters.enabled && entriesQuery.isLoading) || (consumptionFilters.enabled && consumptionsQuery.isLoading)
  const error = entriesFilters.enabled && entriesQuery.isError

  const items = mergedItems(typeFilter, entries, consumptions)
  const grouped = groupByDate(items)
  const isEmpty = items.length === 0

  const handleSaveNote = async (type, entry, notes) => {
    const mutation = type === 'routine' ? updateEntry : updateConsumption
    const vars =
      type === 'routine'
        ? { entryId: entry.id, patch: { notes }, updatedAt: entry.updated_at }
        : { consumptionId: entry.id, patch: { notes }, updatedAt: entry.updated_at }

    try {
      await mutation.mutateAsync(vars)
      setEditingNote(null)
      setSavedNote(`${type}-${entry.id}`)
      setTimeout(() => setSavedNote(null), 2000)
    } catch {
      setEditingNote(null)
    }
  }

  const handleTypeFilterChange = (value) => {
    setTypeFilter(value)
    if (value === 'consumptions') setRoutineFilter('')
    if (value === 'routines') setStockFilter('')
  }

  const loadMore = () => {
    if (entriesQuery.hasNextPage && !entriesQuery.isFetchingNextPage) entriesQuery.fetchNextPage()
  }

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('history.title')}</h1>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={({ dateFrom: f, dateTo: to }) => {
            setDateFrom(f)
            setDateTo(to)
          }}
        />
      </div>

      <div className={s.filterRow}>
        <div className={s.filterField}>
          <label className={s.filterLabel} htmlFor="history-filter-type">
            {t('history.filterType')}
          </label>
          <select
            id="history-filter-type"
            className={shared.input}
            value={typeFilter}
            onChange={(e) => handleTypeFilterChange(e.target.value)}
          >
            <option value="all">{t('history.allTypes')}</option>
            <option value="routines">{t('history.routineEntries')}</option>
            <option value="consumptions">{t('history.stockConsumptions')}</option>
          </select>
        </div>

        {typeFilter !== 'consumptions' && (
          <div className={s.filterField}>
            <label className={s.filterLabel} htmlFor="history-filter-routine">
              {t('history.filterRoutine')}
            </label>
            <select
              id="history-filter-routine"
              className={shared.input}
              value={routineFilter}
              onChange={(e) => setRoutineFilter(e.target.value)}
            >
              <option value="">{t('history.allRoutines')}</option>
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {typeFilter !== 'routines' && (
          <div className={s.filterField}>
            <label className={s.filterLabel} htmlFor="history-filter-stock">
              {t('history.filterStock')}
            </label>
            <select
              id="history-filter-stock"
              className={shared.input}
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
            >
              <option value="">{t('history.allStocks')}</option>
              {stocks.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className={shared.spinner} data-testid="spinner" />
      ) : error ? (
        <p className={shared.muted}>{t('common.error')}</p>
      ) : isEmpty ? (
        <p className={shared.muted}>{t('history.empty')}</p>
      ) : (
        <>
          {grouped.map(({ dateLabel, items: dayItems }) => (
            <section key={dateLabel} className={s.group}>
              <p className={shared.sectionTitle}>{dateLabel}</p>
              <div className={s.list}>
                {dayItems.map((e) => {
                  const key = `${e._type}-${e.id}`
                  const isEditing = editingNote && editingNote.type === e._type && editingNote.id === e.id
                  const justSaved = savedNote === key
                  return (
                    <EntryCard
                      key={key}
                      entry={e}
                      isEditing={isEditing}
                      justSaved={justSaved}
                      onStartEdit={() => setEditingNote({ type: e._type, id: e.id, notes: e.notes || '' })}
                      onCancelEdit={() => setEditingNote(null)}
                      onSave={(notes) => handleSaveNote(e._type, e, notes)}
                    />
                  )
                })}
              </div>
            </section>
          ))}
          {typeFilter !== 'consumptions' && entriesQuery.hasNextPage && (
            <button type="button" className={s.moreBtn} onClick={loadMore} disabled={entriesQuery.isFetchingNextPage}>
              {entriesQuery.isFetchingNextPage ? t('common.loading') : t('history.loadMore')}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function EntryCard({ entry, isEditing, justSaved, onStartEdit, onCancelEdit, onSave }) {
  const { t } = useTranslation()
  const isRoutine = entry._type === 'routine'
  const title = isRoutine ? entry.routine_name : entry.stock_name
  const authorLabel = isRoutine
    ? entry.completed_by_username && t('sharing.completedBy', { username: entry.completed_by_username })
    : entry.consumed_by_username && t('sharing.consumedBy', { username: entry.consumed_by_username })

  const totalQty = entry.consumed_lots?.reduce((sum, l) => sum + l.quantity, 0) ?? 0
  const lotNumbers = (entry.consumed_lots || [])
    .filter((l) => l.lot_number)
    .map((l) => l.lot_number)
    .join(', ')

  return (
    <div
      className={cx(shared.card, shared.cardBorderSuccess, s.entryCard)}
      data-testid="history-entry"
      data-entry-type={entry._type}
    >
      <div className={shared.cardHeader}>
        <div className={shared.cardMeta}>
          <span className={cx(shared.cardTitle, shared.cardTitleFlex, s.entryName)}>
            <Icon name={isRoutine ? 'check' : 'package'} size="sm" />
            <span>{title}</span>
          </span>
          <span className={shared.cardSubtitle}>
            <span>{formatTime(entry.created_at)}</span>
            {authorLabel && <span>{authorLabel}</span>}
            {!isRoutine && <span className={s.entryBadge}>−{entry.quantity}</span>}
            {isRoutine && <span className={s.entryBadge}>✓</span>}
          </span>
          {entry.consumed_lots?.length > 0 && (
            <span className={shared.cardStockBadge}>
              <Icon name="package" size="sm" />
              <span>
                {totalQty} × {entry.stock_name}
                {lotNumbers && <span className={s.consumedLot}> ({lotNumbers})</span>}
              </span>
            </span>
          )}
          <div className={s.notesRow}>
            {isEditing ? (
              <input
                className={cx(shared.input, s.notesInput)}
                autoFocus
                defaultValue={entry.notes || ''}
                placeholder={t('history.notesPlaceholder')}
                onBlur={(ev) => onSave(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') onSave(ev.target.value)
                  if (ev.key === 'Escape') onCancelEdit()
                }}
              />
            ) : (
              <button
                type="button"
                className={cx(s.notesBtn, !entry.notes && s.notesPlaceholder)}
                onClick={onStartEdit}
              >
                {entry.notes || t('history.notesPlaceholder')}
              </button>
            )}
            {justSaved && <span className={s.notesSaved}>{t('history.savedNote')}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

function mergedItems(typeFilter, entries, consumptions) {
  const routineItems = entries.map((e) => ({ ...e, _type: 'routine' }))
  const consumptionItems = consumptions.map((c) => ({ ...c, _type: 'consumption' }))
  if (typeFilter === 'routines') return routineItems
  if (typeFilter === 'consumptions') return consumptionItems
  return [...routineItems, ...consumptionItems].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}

function groupByDate(entries) {
  const map = new Map()
  for (const e of entries) {
    const label = new Date(e.created_at).toLocaleDateString(getLocale(), {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(e)
  }
  return Array.from(map.entries()).map(([dateLabel, items]) => ({
    dateLabel,
    items,
  }))
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
  })
}
