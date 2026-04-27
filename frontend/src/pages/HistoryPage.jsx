import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import DateRangePicker from '../components/DateRangePicker'
import HistoryEntryCard from '../components/HistoryEntryCard'
import { useEntries, useStockConsumptions } from '../hooks/useEntries'
import { useRoutines } from '../hooks/useRoutines'
import { useStockList } from '../hooks/useStock'
import { useUpdateConsumption } from '../hooks/mutations/useUpdateConsumption'
import { useUpdateEntry } from '../hooks/mutations/useUpdateEntry'
import { useToast } from '../components/useToast'
import cx from '../utils/cx'
import { groupEntriesByDate } from '../utils/historyGroups'
import shared from '../styles/shared.module.css'
import s from './HistoryPage.module.css'

const VALID_TYPES = new Set(['all', 'routines', 'consumptions'])

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
  // Initial filters come from the URL query so deep-links like
  // `/history?routine=12` (opened from a routine's history button) land on
  // a pre-filtered view. `type` defaults to "routines" when a `routine` id
  // is present to keep the view focused on that routine's entries.
  const [searchParams] = useSearchParams()
  const initialRoutine = searchParams.get('routine') ?? ''
  const initialStock = searchParams.get('stock') ?? ''
  const typeParam = searchParams.get('type')
  const initialType = VALID_TYPES.has(typeParam)
    ? typeParam
    : initialRoutine
      ? 'routines'
      : initialStock
        ? 'consumptions'
        : 'all'

  const [typeFilter, setTypeFilter] = useState(initialType)
  const [routineFilter, setRoutineFilter] = useState(initialRoutine)
  const [stockFilter, setStockFilter] = useState(initialStock)
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(todayStr)
  const [editingNote, setEditingNote] = useState(null)
  const { showToast } = useToast()

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
  const grouped = groupEntriesByDate(items)
  const isEmpty = items.length === 0

  const handleSaveNote = async (type, entry, notes) => {
    const mutation = type === 'routine' ? updateEntry : updateConsumption
    const vars =
      type === 'routine'
        ? {
            entryId: entry.id,
            routineName: entry.routine_name,
            patch: { notes },
            updatedAt: entry.updated_at,
          }
        : {
            consumptionId: entry.id,
            stockName: entry.stock_name,
            patch: { notes },
            updatedAt: entry.updated_at,
          }

    try {
      await mutation.mutateAsync(vars)
      setEditingNote(null)
      showToast({ type: 'success', message: t('history.savedNote') })
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
    <div>
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
              <p className={cx(shared.sectionTitle, s.dayHeader)}>{dateLabel}</p>
              <div className={s.list}>
                {dayItems.map((e) => {
                  const key = `${e._type}-${e.id}`
                  const isEditing = editingNote && editingNote.type === e._type && editingNote.id === e.id
                  return (
                    <HistoryEntryCard
                      key={key}
                      entry={e}
                      isEditing={isEditing}
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

function mergedItems(typeFilter, entries, consumptions) {
  const routineItems = entries.map((e) => ({ ...e, _type: 'routine' }))
  const consumptionItems = consumptions.map((c) => ({ ...c, _type: 'consumption' }))
  if (typeFilter === 'routines') return routineItems
  if (typeFilter === 'consumptions') return consumptionItems
  return [...routineItems, ...consumptionItems].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
}
