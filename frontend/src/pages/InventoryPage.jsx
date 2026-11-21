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
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockGroups, useStockList } from '../hooks/useStock'
import { MAX_PINNED } from '../hooks/mutations/useToggleStockPin'
import cx from '../utils/cx'
import {
  readCollapsedGroups,
  readInventoryScroll,
  writeCollapsedGroups,
  writeInventoryScroll,
} from '../utils/inventoryPrefs'
import { worstSeverity } from '../utils/stockAlerts'
import { effectiveGroupId } from '../utils/stockGroup'
import { buildFilterChips, filterStocks } from '../utils/stockSearch'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import layout from '../styles/layout.module.css'
import s from './InventoryPage.module.css'

/** Section key for products with no group of the viewer's own. */

export default function InventoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const { data: stocks = [], isLoading } = useStockList()
  const { data: groups = [] } = useStockGroups()
  const reachable = useServerReachable()

  // Which stock's picker is currently open (−1 consume flow). The picker
  // itself owns the consumption mutation; this state is just "which row
  // spawned it".
  const [pickerStock, setPickerStock] = useState(null)
  const [consumingId, setConsumingId] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const [collapsed, setCollapsed] = useState(() => readCollapsedGroups())
  const [query, setQuery] = useState('')
  const [activeChip, setActiveChip] = useState('all')

  // Two sticky layers: the search bar sits under the app header, and the
  // section headers stick under the bar. The bar's height is measured rather
  // than written down twice — the chips row is one line today, but a longer
  // translation or a larger text size changes it, and a stale number would
  // slide the headers under the bar.
  const barRef = useRef(null)
  const scrollYRef = useRef(0)
  const [barHeight, setBarHeight] = useState(0)

  useEffect(() => {
    const el = barRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // Border-box, not `contentRect`: the latter excludes the bar's padding,
    // which is ~18px here — enough for a pinned section header to sit under
    // the bar instead of below it.
    const observer = new ResizeObserver(() => setBarHeight(el.getBoundingClientRect().height))
    observer.observe(el)
    return () => observer.disconnect()
  }, [stocks.length])

  const clearFilters = () => {
    setQuery('')
    setActiveChip('all')
  }

  const handleConsume = (stock) => {
    if (consumingId) return
    if (!stock.lots || stock.lots.length === 0) {
      showToast({ type: 'error', message: t('common.actionError') })
      return
    }
    setPickerStock(stock)
  }

  const handlePickerConsumed = () => {
    const id = pickerStock?.id
    if (id != null) {
      setFlashId(id)
      setTimeout(() => setFlashId(null), 600)
    }
  }

  // Every section that can exist, filter or no filter: a group with nothing
  // visible under the current search still exists, and its folded state should
  // outlive the search. Derived from `groups` rather than from what is on
  // screen, so a deleted group is pruned but a temporarily empty one is not.
  const validSectionKeys = groups.map((group) => String(group.id))

  const toggleCollapse = (key) =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      writeCollapsedGroups(next, validSectionKeys)
      return next
    })

  // Where the user was when they left. Restoring on mount rather than making
  // the detail page's back link a history `back`: there are three ways into a
  // stock detail, and from the stock form a back would land on the edit form
  // the user just submitted. This works from all of them.
  //
  // `useLayoutEffect` so the jump happens before paint, and only once the list
  // has rendered — restoring while the spinner is up would scroll a page with
  // no height. The saved offset is discarded when a filter is active: the
  // filtered list is a different, shorter list, and an offset into it means
  // nothing.
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
      writeInventoryScroll(scrollYRef.current)
    }
  }, [])

  if (isLoading) return <Spinner />

  // Filtering is client-side by design: `useStockList` holds the whole
  // collection with no pagination and the cache is persisted, so this is
  // instant and works offline without a round trip.
  const isFiltering = query.trim().length > 0 || activeChip !== 'all'
  const chips = buildFilterChips(stocks, groups, query)
  const visibleStocks = filterStocks(stocks, groups, activeChip, query)

  // Alphabetical rather than by pin order: with at most four items the order
  // barely matters, and a list that never reshuffles is what makes the section
  // worth having. Sliced defensively — the server caps this, but a stale cache
  // or a raised limit must not turn a shortcut into a second list.
  const pinnedStocks = stocks
    .filter((st) => st.is_pinned)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_PINNED)

  const knownGroupIds = new Set(groups.map((g) => g.id))
  const ungroupedStocks = visibleStocks.filter((st) => {
    const gid = effectiveGroupId(st)
    return !gid || !knownGroupIds.has(gid)
  })

  // Only categories get a titled, foldable card. Products with no category
  // follow in a card of the same look with no title (2026-11-19): someone who
  // never made categories sees a plain list, not everything under "No
  // category"; with categories, the loose products no longer read as part of
  // the last one, since each category sits in its own card. Shared products
  // routinely land here (the group is per viewer, `my_group ?? group`).
  const sections = groups
    .map((group) => ({
      key: String(group.id),
      label: group.name,
      stocks: visibleStocks.filter((st) => effectiveGroupId(st) === group.id),
    }))
    .filter((section) => section.stocks.length > 0)

  const renderStockRow = (stock) => (
    <StockRow
      key={stock.id}
      stock={stock}
      consuming={consumingId === stock.id}
      flashing={flashId === stock.id}
      onConsume={handleConsume}
    />
  )

  // Rows are separators inside one surface, not a stack of free-floating
  // cards: at 44 px each, a per-product border and margin would cost more
  // vertical space than the row itself.
  const rowList = (rows) => <div className={s.rowList}>{rows.map(renderStockRow)}</div>

  return (
    <div style={{ '--inventory-bar-h': `${barHeight}px` }}>
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
          barRef={barRef}
          query={query}
          onQueryChange={setQuery}
          chips={chips}
          activeChip={activeChip}
          onChipChange={setActiveChip}
        />
      )}

      {/* No "N products need attention" banner: the Atención chip above filters
          them in one tap, and each row says its own reason (StockRow,
          `stockRowReasons`). */}

      {/* Pinned products, repeated here and left in their group below. The
          duplication is the point: it removes a scroll from the most frequent
          action for four items, and taking them out of their group would make
          "Diabetes (5)" a lie. Hidden while filtering: it is a shortcut over
          the whole inventory, not part of a filtered result. */}
      {!isFiltering && pinnedStocks.length > 0 && (
        <div className={s.pinnedSection} data-testid="pinned-section">
          <h2 className={s.pinnedTitle}>
            <Icon name="pin" size="sm" />
            {t('inventory.pinnedTitle')}
          </h2>
          {rowList(pinnedStocks)}
        </div>
      )}

      {stocks.length === 0 && <EmptyCard title={t('inventory.emptyTitle')} message={t('inventory.emptyBody')} />}

      {stocks.length > 0 && visibleStocks.length === 0 && (
        <EmptyCard
          title={t('inventory.noMatchesTitle')}
          message={t('inventory.noMatchesBody')}
          action={{ label: t('inventory.clearFilters'), onClick: clearFilters }}
        />
      )}

      {/* Grouping is turned off while filtering: section headers over a
          handful of results are noise, and the user is looking for one thing,
          not browsing a taxonomy. */}
      {isFiltering
        ? visibleStocks.length > 0 && rowList(visibleStocks)
        : sections.map((section) => {
            const severity = worstSeverity(section.stocks)
            return (
              // A group is one card with its title inside: what belongs together
              // shares a box (it replaced a 3 px rail outside the left edge,
              // which read as decoration, not as grouping), and a folded group
              // stays a card with a chevron — clearly something to open.
              <div key={section.key} className={s.groupCard} data-testid="group-box" data-section={section.key}>
                <button
                  type="button"
                  className={cx(s.groupCardHeader, s.groupHeaderSticky)}
                  onClick={() => toggleCollapse(section.key)}
                  aria-expanded={!collapsed[section.key]}
                >
                  <span className={s.groupCardName}>{section.label}</span>
                  <span className={s.groupCardCount} data-testid="group-count">
                    {section.stocks.length}
                  </span>
                  <span className={s.groupCardEnd}>
                    {/* Survives collapsing, which is the point: folding a group
                        must not hide that something inside is red. */}
                    {severity && (
                      <span
                        className={cx(cards.dot, severity === 'danger' ? cards.dotDanger : cards.dotWarning)}
                        data-testid="group-severity-dot"
                        data-severity={severity}
                      />
                    )}
                    <Icon name={collapsed[section.key] ? 'chevron-right' : 'chevron-down'} size="sm" />
                  </span>
                </button>
                {!collapsed[section.key] && <div className={s.groupCardRows}>{section.stocks.map(renderStockRow)}</div>}
              </div>
            )
          })}

      {!isFiltering && ungroupedStocks.length > 0 && (
        <div className={s.looseCard} data-testid="ungrouped-list">
          {ungroupedStocks.map(renderStockRow)}
        </div>
      )}

      {pickerStock && (
        <LotPickerModal
          // The live row, not the one clicked: a refused consume refetches the
          // list, and the picker must stop offering a batch that is gone.
          stock={stocks.find((row) => row.id === pickerStock.id) ?? pickerStock}
          onClose={() => {
            setPickerStock(null)
            setConsumingId(null)
          }}
          onConsumed={handlePickerConsumed}
        />
      )}
    </div>
  )
}
