import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EmptyCard from '../components/EmptyCard'
import Icon from '../components/Icon'
import InventorySearchBar from '../components/InventorySearchBar'
import LotPickerModal from '../components/LotPickerModal'
import Spinner from '../components/Spinner'
import StockRow from '../components/StockRow'
import { useToast } from '../components/useToast'
import { useConsumeOne } from '../hooks/useConsumeOne'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockGroups, useStockList } from '../hooks/useStock'
import cx from '../utils/cx'
import {
  clearLegacyInventoryPrefs,
  readInventoryFilter,
  readInventoryScroll,
  readSwipeHintSeen,
  writeInventoryFilter,
  writeInventoryScroll,
  writeSwipeHintSeen,
} from '../utils/inventoryPrefs'
import { buildFilterChips, filterStocks, resolveChip } from '../utils/stockSearch'
import { getLocale } from '../utils/time'
import buttons from '../styles/buttons.module.css'
import layout from '../styles/layout.module.css'
import s from './InventoryPage.module.css'

export default function InventoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const { data: stocks = [], isLoading } = useStockList()
  const { data: groups = [] } = useStockGroups()
  const reachable = useServerReachable()

  const [flashId, setFlashId] = useState(null)
  // The gesture has no visible control on touch, so it is taught once.
  const [showSwipeHint, setShowSwipeHint] = useState(
    () => !readSwipeHintSeen() && window.matchMedia('(hover: none)').matches,
  )
  const dismissSwipeHint = () => {
    writeSwipeHintSeen()
    setShowSwipeHint(false)
  }
  const { consumeOne, consumingId, pickerStock, closePicker, onPickerConsumed } = useConsumeOne({
    onConsumed: ({ id }) => {
      dismissSwipeHint()
      setFlashId(id)
      setTimeout(() => setFlashId(null), 600)
    },
  })
  const [query, setQuery] = useState('')
  // The filter the user chose; `null` until they do (see `resolveChip`).
  const [chosenChip, setChosenChip] = useState(() => readInventoryFilter())
  const scrollYRef = useRef(0)
  // Read at teardown: a search result is a different list, so its offset is
  // not worth restoring.
  const searchingRef = useRef(false)

  useEffect(() => {
    searchingRef.current = query.trim().length > 0
  }, [query])

  useEffect(() => {
    clearLegacyInventoryPrefs()
  }, [])

  const chooseChip = (chipId) => {
    setQuery('')
    setChosenChip(chipId)
    writeInventoryFilter(chipId)
    scrollYRef.current = 0
    window.scrollTo(0, 0)
  }

  // Where the user was when they left. Restoring on mount rather than making
  // the detail page's back link a history `back`: there are three ways into a
  // stock detail, and from the stock form a back would land on the edit form
  // the user just submitted. This works from all of them.
  //
  // `useLayoutEffect` so the jump happens before paint, and only once the list
  // has rendered — restoring while the spinner is up would scroll a page with
  // no height. The filter is restored with it, so the offset is into the same
  // list; leaving from a search saves 0.
  useLayoutEffect(() => {
    if (isLoading) return
    const y = readInventoryScroll()
    if (y <= 0) return
    window.scrollTo(0, y)
    // Seed the tracker too, or leaving again without touching the scroll would
    // save 0 and lose the position the user was just returned to.
    scrollYRef.current = y
  }, [isLoading])

  // Tracked into a ref while on this route, and written on the way out.
  //
  // Reading `window.scrollY` at teardown does not work: navigating away fires
  // a reset-to-0 scroll, and it arrives *after* `location.pathname` has become
  // the new route but *before* React tears this page down — so both a late read
  // and an unguarded scroll listener record 0. Comparing the live pathname to
  // this page's own is what filters that event out; it is an exact signal, not
  // a guess about how far the user meant to scroll.
  useEffect(() => {
    // Captured here rather than compared against the router's `pathname`: the
    // check has to work against whatever `window.location` says, and under a
    // MemoryRouter (tests) that never changes — which makes the guard inert
    // there and exact in a browser, instead of always-false in both.
    const routeOnMount = window.location.pathname
    const onScroll = () => {
      if (window.location.pathname !== routeOnMount) return
      scrollYRef.current = window.scrollY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      writeInventoryScroll(searchingRef.current ? 0 : scrollYRef.current)
    }
  }, [])

  if (isLoading) return <Spinner />

  // Filtering is client-side by design: `useStockList` holds the whole
  // collection with no pagination and the cache is persisted, so this is
  // instant and works offline without a round trip.
  const searching = query.trim().length > 0
  const chips = buildFilterChips(stocks, groups)
  const activeChip = resolveChip(chosenChip, chips)
  const visibleStocks = filterStocks(stocks, groups, activeChip, query, getLocale())

  return (
    <div>
      <div className={layout.topBar}>
        <h1 className={layout.pageTitle}>{t('inventory.title')}</h1>
        <div className={s.topActions}>
          <button
            type="button"
            className={cx(buttons.icon, buttons.outlined)}
            onClick={() => navigate('/inventory/groups')}
            aria-label={t('inventory.manageGroups')}
            title={t('inventory.manageGroups')}
          >
            <Icon name="tag" />
          </button>
          <button
            type="button"
            className={cx(buttons.icon, buttons.iconFilled, !reachable && buttons.disabled)}
            onClick={() => {
              if (!reachable) {
                showToast({ type: 'error', message: t('offline.pageUnavailable') })
                return
              }
              navigate('/inventory/new')
            }}
            aria-disabled={!reachable}
            aria-label={t('inventory.newButton')}
            title={!reachable ? t('offline.pageUnavailable') : t('inventory.newButton')}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>

      {stocks.length > 0 && (
        <InventorySearchBar
          query={query}
          onQueryChange={setQuery}
          chips={chips}
          activeChip={activeChip}
          onChipChange={chooseChip}
        />
      )}

      {stocks.length === 0 && (
        <EmptyCard
          title={t('inventory.emptyTitle')}
          message={t('inventory.emptyBody')}
          action={
            reachable
              ? { label: t('inventory.emptyAction'), to: '/inventory/new' }
              : {
                  label: t('inventory.emptyAction'),
                  unavailable: true,
                  onClick: () => showToast({ type: 'error', message: t('offline.pageUnavailable') }),
                }
          }
        />
      )}

      {searching && visibleStocks.length === 0 && (
        <EmptyCard
          title={t('inventory.noMatchesTitle')}
          message={t('inventory.noMatchesBody')}
          action={{ label: t('inventory.clearFilters'), onClick: () => setQuery(''), secondary: true }}
        />
      )}

      {/* Attention stays on offer at 0, and that is good news. */}
      {stocks.length > 0 && !searching && visibleStocks.length === 0 && (
        <EmptyCard
          title={t('inventory.noAttentionTitle')}
          message={t('inventory.noAttentionBody')}
          action={{ label: t('inventory.filterAll'), onClick: () => chooseChip('all'), secondary: true }}
        />
      )}

      {/* One list, each product once. Rows are separators inside one surface,
          not free-floating cards: at this height a border and margin per
          product would cost more than the row itself. */}
      {showSwipeHint && visibleStocks.length > 0 && (
        <p className={s.swipeHint} data-testid="swipe-hint">
          <Icon name="chevron-right" size="sm" />
          <span className={s.swipeHintText}>{t('inventory.swipeHint')}</span>
          <button
            type="button"
            className={cx(buttons.hit, s.swipeHintClose)}
            onClick={dismissSwipeHint}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <Icon name="x" size="sm" />
          </button>
        </p>
      )}

      {visibleStocks.length > 0 && (
        <div className={s.rowList} data-testid="inventory-list">
          {visibleStocks.map((stock) => (
            <StockRow
              key={stock.id}
              stock={stock}
              consuming={consumingId === stock.id}
              flashing={flashId === stock.id}
              onConsume={consumeOne}
            />
          ))}
        </div>
      )}

      {pickerStock && (
        <LotPickerModal
          // The live row, not the one clicked: a refused consume refetches the
          // list, and the picker must stop offering a batch that is gone.
          stock={stocks.find((row) => row.id === pickerStock.id) ?? pickerStock}
          onClose={closePicker}
          onConsumed={onPickerConsumed}
        />
      )}
    </div>
  )
}
