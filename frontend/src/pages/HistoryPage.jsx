import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import DateRangePicker from '../components/DateRangePicker'
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
  const [routines, setRoutines] = useState([])
  const [entries, setEntries] = useState([])
  const [consumptions, setConsumptions] = useState([])
  const [stocks, setStocks] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState('all')
  const [routineFilter, setRoutineFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(todayStr)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [editingNote, setEditingNote] = useState(null)
  const [savedNote, setSavedNote] = useState(null)
  const { t } = useTranslation()

  useEffect(() => {
    Promise.all([
      api
        .get('/routines/')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setRoutines(d.results ?? d))
        .catch(() => {}),
      api
        .get('/stock/')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => setStocks(d.results ?? d))
        .catch(() => {}),
    ])
  }, [])

  const fetchEntries = async (p, filter, replace) => {
    const params = new URLSearchParams({ page: p })
    if (filter) params.set('routine', filter)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const res = await api.get(`/entries/?${params}`)
    if (!res.ok) {
      setError(true)
      return
    }
    const data = await res.json()
    const results = data.results ?? data
    setEntries((prev) => (replace ? results : [...prev, ...results]))
    setHasMore(Boolean(data.next))
  }

  const fetchConsumptions = async (sFilter) => {
    const params = new URLSearchParams()
    if (sFilter) params.set('stock', sFilter)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    const res = await api.get(`/stock-consumptions/?${params}`)
    if (!res.ok) return
    const data = await res.json()
    setConsumptions(data.results ?? data)
  }

  useEffect(() => {
    setLoading(true)
    setError(false)
    setPage(1)
    const promises = []
    if (typeFilter !== 'consumptions') {
      promises.push(fetchEntries(1, routineFilter, true))
    } else {
      setEntries([])
      setHasMore(false)
    }
    if (typeFilter !== 'routines') {
      promises.push(fetchConsumptions(stockFilter))
    } else {
      setConsumptions([])
    }
    Promise.all(promises).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, routineFilter, stockFilter, dateFrom, dateTo])

  const loadMore = async () => {
    const next = page + 1
    setLoadingMore(true)
    await fetchEntries(next, routineFilter, false)
    setPage(next)
    setLoadingMore(false)
  }

  const mergedItems = () => {
    const routineItems = entries.map((e) => ({ ...e, _type: 'routine' }))
    const consumptionItems = consumptions.map((c) => ({ ...c, _type: 'consumption' }))
    if (typeFilter === 'routines') return routineItems
    if (typeFilter === 'consumptions') return consumptionItems
    return [...routineItems, ...consumptionItems].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }

  const items = mergedItems()
  const grouped = groupByDate(items)
  const isEmpty = items.length === 0

  const handleSaveNote = async (type, id, notes) => {
    const endpoint = type === 'routine' ? `/entries/${id}/` : `/stock-consumptions/${id}/`
    const res = await api.patch(endpoint, { notes })
    if (!res.ok) return
    if (type === 'routine') {
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, notes } : e)))
    } else {
      setConsumptions((prev) => prev.map((c) => (c.id === id ? { ...c, notes } : c)))
    }
    setEditingNote(null)
    setSavedNote(`${type}-${id}`)
    setTimeout(() => setSavedNote(null), 2000)
  }

  const handleTypeFilterChange = (value) => {
    setTypeFilter(value)
    if (value === 'consumptions') setRoutineFilter('')
    if (value === 'routines') setStockFilter('')
  }

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('history.title')}</h1>
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={({ dateFrom: f, dateTo: t }) => {
            setDateFrom(f)
            setDateTo(t)
          }}
        />
      </div>

      <div className={s.filterRow}>
        <div className={s.filterField}>
          <label className={s.filterLabel}>{t('history.filterType')}</label>
          <select className={s.filter} value={typeFilter} onChange={(e) => handleTypeFilterChange(e.target.value)}>
            <option value="all">{t('history.allTypes')}</option>
            <option value="routines">{t('history.routineEntries')}</option>
            <option value="consumptions">{t('history.stockConsumptions')}</option>
          </select>
        </div>

        {typeFilter !== 'consumptions' && (
          <div className={s.filterField}>
            <label className={s.filterLabel}>{t('history.filterRoutine')}</label>
            <select className={s.filter} value={routineFilter} onChange={(e) => setRoutineFilter(e.target.value)}>
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
            <label className={s.filterLabel}>{t('history.filterStock')}</label>
            <select className={s.filter} value={stockFilter} onChange={(e) => setStockFilter(e.target.value)}>
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
              <p className={s.dateLabel}>{dateLabel}</p>
              <div className={s.list}>
                {dayItems.map((e) => {
                  const key = `${e._type}-${e.id}`
                  const isEditing = editingNote && editingNote.type === e._type && editingNote.id === e.id
                  const justSaved = savedNote === key

                  return (
                    <div key={key} className={cx(s.entry, e._type === 'routine' && s.entryRoutine)}>
                      <div className={s.entryMain}>
                        <span className={s.entryBadge}>{e._type === 'routine' ? '✓' : `−${e.quantity}`}</span>
                        <span className={s.entryName}>
                          {e._type === 'routine' ? e.routine_name : e.stock_name}
                          {e._type === 'routine' && e.completed_by_username && (
                            <span className={s.completedBy}>
                              {' '}
                              {t('sharing.completedBy', { username: e.completed_by_username })}
                            </span>
                          )}
                          {e._type === 'consumption' && e.consumed_by_username && (
                            <span className={s.completedBy}>
                              {' '}
                              {t('sharing.consumedBy', { username: e.consumed_by_username })}
                            </span>
                          )}
                        </span>
                        <span className={s.entryTime}>{formatTime(e.created_at)}</span>
                      </div>
                      {e.consumed_lots && e.consumed_lots.length > 0 && (
                        <div className={s.consumedRow}>
                          {(() => {
                            const totalQty = e.consumed_lots.reduce((sum, l) => sum + l.quantity, 0)
                            const name = e._type === 'routine' ? e.stock_name : e.stock_name
                            const lotNumbers = e.consumed_lots
                              .filter((l) => l.lot_number)
                              .map((l) => l.lot_number)
                              .join(', ')
                            return (
                              <span>
                                {totalQty} × {name}
                                {lotNumbers && <span className={s.consumedLot}> ({lotNumbers})</span>}
                              </span>
                            )
                          })()}
                        </div>
                      )}
                      <div className={s.notesRow}>
                        {isEditing ? (
                          <input
                            className={s.notesInput}
                            autoFocus
                            defaultValue={e.notes || ''}
                            placeholder={t('history.notesPlaceholder')}
                            onBlur={(ev) => handleSaveNote(e._type, e.id, ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') {
                                handleSaveNote(e._type, e.id, ev.target.value)
                              }
                              if (ev.key === 'Escape') setEditingNote(null)
                            }}
                          />
                        ) : (
                          <button
                            className={cx(s.notesBtn, !e.notes && s.notesPlaceholder)}
                            onClick={() =>
                              setEditingNote({
                                type: e._type,
                                id: e.id,
                                notes: e.notes || '',
                              })
                            }
                          >
                            {e.notes || t('history.notesPlaceholder')}
                          </button>
                        )}
                        {justSaved && <span className={s.notesSaved}>{t('history.savedNote')}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          {typeFilter !== 'consumptions' && hasMore && (
            <button className={s.moreBtn} onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t('common.loading') : t('history.loadMore')}
            </button>
          )}
        </>
      )}
    </div>
  )
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
