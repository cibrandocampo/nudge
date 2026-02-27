import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { getLocale } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './HistoryPage.module.css'

export default function HistoryPage() {
  const [routines, setRoutines] = useState([])
  const [entries, setEntries] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [routineFilter, setRoutineFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    api
      .get('/routines/')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setRoutines(d.results ?? d))
      .catch(() => {})
  }, [])

  const fetchEntries = async (p, filter, replace) => {
    const params = new URLSearchParams({ page: p })
    if (filter) params.set('routine', filter)
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

  useEffect(() => {
    setLoading(true)
    setError(false)
    setPage(1)
    fetchEntries(1, routineFilter, true).finally(() => setLoading(false))
  }, [routineFilter])

  const loadMore = async () => {
    const next = page + 1
    setLoadingMore(true)
    await fetchEntries(next, routineFilter, false)
    setPage(next)
    setLoadingMore(false)
  }

  const grouped = groupByDate(entries)

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('history.title')}</h1>
        <select className={s.filter} value={routineFilter} onChange={(e) => setRoutineFilter(e.target.value)}>
          <option value="">{t('history.allRoutines')}</option>
          {routines.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className={shared.muted}>{t('common.loading')}</p>
      ) : error ? (
        <p className={shared.muted}>{t('common.error')}</p>
      ) : entries.length === 0 ? (
        <p className={shared.muted}>{t('history.empty')}</p>
      ) : (
        <>
          {grouped.map(({ dateLabel, items }) => (
            <section key={dateLabel} className={s.group}>
              <p className={s.dateLabel}>{dateLabel}</p>
              <div className={s.list}>
                {items.map((e) => (
                  <div key={e.id} className={s.entry}>
                    <span className={s.entryName}>{e.routine_name}</span>
                    <span className={s.entryTime}>{formatTime(e.created_at)}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {hasMore && (
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
  return Array.from(map.entries()).map(([dateLabel, items]) => ({ dateLabel, items }))
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' })
}
