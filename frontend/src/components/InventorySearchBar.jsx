import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import Icon from './Icon'
import s from './InventorySearchBar.module.css'

/**
 * The inventory's find controls: a text box and a row of single-select filter
 * chips, both sticky under the page title.
 *
 * Presentational on purpose — the page owns `query` and `activeChip`, and
 * `buildFilterChips` in `utils/stockSearch.js` decides which chips exist and
 * what they count. This component only draws them and reports clicks, so the
 * filtering rules stay testable without a DOM.
 *
 * Chips arrive as descriptors (`kind`, `name`, `count`); their labels are
 * resolved here because this is the layer that has i18next.
 */
export default function InventorySearchBar({ barRef, query, onQueryChange, chips, activeChip, onChipChange }) {
  const { t } = useTranslation()

  const chipLabel = (chip) => {
    if (chip.kind === 'group') return chip.name
    if (chip.kind === 'attention') return t('inventory.filterAttention')
    if (chip.kind === 'ungrouped') return t('inventory.filterUngrouped')
    return t('inventory.filterAll')
  }

  return (
    <div className={s.bar} ref={barRef}>
      <div className={s.searchBox}>
        <Icon name="search" size="sm" className={s.searchIcon} />
        <input
          type="search"
          className={s.input}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t('inventory.searchPlaceholder')}
          aria-label={t('inventory.searchPlaceholder')}
          data-testid="stock-search"
        />
        {query && (
          <button
            type="button"
            className={s.clear}
            onClick={() => onQueryChange('')}
            aria-label={t('inventory.searchClear')}
            title={t('inventory.searchClear')}
            data-testid="stock-search-clear"
          >
            <Icon name="x" size="sm" />
          </button>
        )}
      </div>

      <div className={s.chips} role="group" aria-label={t('inventory.filterAll')}>
        {chips.map((chip) => {
          const active = chip.id === activeChip
          return (
            <button
              key={chip.id}
              type="button"
              className={cx(s.chip, active && s.chipActive, chip.kind === 'attention' && s.chipAttention)}
              onClick={() => onChipChange(chip.id)}
              aria-pressed={active}
              data-testid="stock-filter-chip"
              data-chip={chip.id}
              data-active={active || undefined}
            >
              {chip.kind === 'attention' && <Icon name="alert-triangle" size="sm" />}
              <span>{chipLabel(chip)}</span>
              <span className={s.count}>{chip.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
