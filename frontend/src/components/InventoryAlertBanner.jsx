import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { buildStockAlerts } from '../utils/stockAlerts'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import cards from '../styles/cards.module.css'
import s from './InventoryAlertBanner.module.css'

const DOT = { danger: cards.dotDanger, warning: cards.dotWarning }

/**
 * One collapsible banner for everything in the inventory that needs
 * attention, replacing the four severity cards of T170.
 *
 * Those listed one badge per lot and repeated, above the list, products the
 * list already marks with a coloured dot and border — 240 px with three
 * products and up to 900 px with twenty. This says how many products are
 * affected in one row, and opens on demand into one row per product that
 * links to where the problem can actually be fixed.
 *
 * The open/closed state is deliberately **not** persisted: this is a peek,
 * not a mode. Remembering it open would reproduce the wall of text it
 * replaces.
 */
export default function InventoryAlertBanner({ stocks, today }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const alerts = buildStockAlerts(stocks, today)

  if (alerts.length === 0) return null

  return (
    <div className={s.banner} data-testid="inventory-alert-banner">
      <button type="button" className={s.summary} onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
        <Icon name="alert-triangle" size="sm" className={s.summaryIcon} />
        <span className={s.summaryText}>{t('inventory.alertBannerSummary', { count: alerts.length })}</span>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" />
      </button>

      {expanded && (
        <ul className={s.list}>
          {alerts.map(({ stock, severity, labels }) => (
            <li key={stock.id}>
              <Link
                to={`/inventory/${stock.id}`}
                className={s.row}
                data-testid="inventory-alert-row"
                data-severity={severity}
              >
                <span className={cx(cards.dot, DOT[severity], s.rowDot)} />
                <span className={s.name}>{stock.name}</span>
                <span className={s.labels}>
                  {labels.map((label) => (
                    <span key={label.key} className={cx(s.label, label.tone === 'danger' && s.labelDanger)}>
                      {t(
                        label.key,
                        label.params.date
                          ? { ...label.params, date: formatShortDate(label.params.date) }
                          : label.params,
                      )}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
