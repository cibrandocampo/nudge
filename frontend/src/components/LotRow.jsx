import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import cx from '../utils/cx'
import { iconClassForLot, lotExpirySeverity } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import s from './LotRow.module.css'

/**
 * One lot row, wherever lots are listed: the inventory card and the stock
 * detail render the same thing and used to render it twice.
 *
 * Layout is a subgrid contract shared by the list and its rows, and it lives
 * **only in this module**:
 *
 *   1  quantity (with its icon)   2  expiry   3  lot pill   4  trailing control
 *
 * Column 4 exists only when the list says it has trailing controls, so the
 * read-only inventory card keeps the three-column layout it has today rather
 * than a phantom fourth track and its gap.
 *
 * The grid is only switched on when some lot in the list carries a lot number
 * (`data-with-pills`) — otherwise dates would be aligned into a column nobody
 * needs. `LotRowList` derives that from the lots themselves, so no caller has
 * to remember to compute it.
 */

/**
 * The list container. Owns the grid contract and the two attributes the CSS
 * keys off, and takes the caller's own skin (padding, borders) as `className`.
 *
 * @param lots      raw lots — only read to decide whether pills are in play
 * @param trailing  whether rows carry a control in the last column
 */
export function LotRowList({ lots, trailing = false, className, children, ...rest }) {
  const withPills = (lots ?? []).some((l) => l.lot_number) || undefined
  return (
    <div className={cx(s.list, className)} data-with-pills={withPills} data-trailing={trailing || undefined} {...rest}>
      {children}
    </div>
  )
}

/**
 * The row skeleton: the three cells and the separator between rows. Used by
 * `LotRow` below and by any row that shares the layout but not the content —
 * the stock detail's pack rows show a serial where a group shows expiry and
 * lot number, and are a different row, not a variant of this one.
 */
export function LotRowShell({ testId, expiring, className, main, meta, trailing, ...rest }) {
  return (
    <div className={cx(s.cardLotRow, className)} data-testid={testId} data-expiring={expiring} {...rest}>
      <div className={s.cardLotMain}>{main}</div>
      {/* `display: contents` under the grid, so the children below land
          directly in the parent's columns. */}
      <div className={s.cardLotMeta}>{meta}</div>
      {trailing && <div className={s.trailing}>{trailing}</div>}
    </div>
  )
}

/**
 * A quantity of units, as every lot row renders it. A component rather than an
 * exported class name so pack rows can look identical without importing another
 * module's stylesheet.
 */
export function LotQty({ expired = false, children }) {
  return <span className={cx(s.cardLotQty, expired && s.cardLotQtyExpired)}>{children}</span>
}

/**
 * A lot group as a row: how many units, when they expire, which batch.
 *
 * @param group     a group from `groupLots()`
 * @param today     local-midnight date, passed in so every list on screen
 *                  judges expiry against the same instant
 * @param testId    `data-testid` for the row — the two lists identify their
 *                  rows differently and their specs rely on it
 * @param children  optional trailing control (delete, expander…)
 */
export default function LotRow({ group, today, testId, children, ...rest }) {
  const { t } = useTranslation()
  const sev = lotExpirySeverity(group, today)
  const tint = iconClassForLot(group, today)

  return (
    <LotRowShell
      testId={testId}
      expiring={sev}
      main={
        <>
          <Icon name="package" size="sm" className={cx(s.cardLotIcon, tint)} />
          <LotQty expired={sev === 'reached'}>
            {group.quantity} {t('common.unit')}
          </LotQty>
        </>
      }
      meta={
        <>
          {group.expiry_date && (
            <span className={cx(s.cardLotExpiry, tint)}>
              {t('inventory.lotExpiryDate', { date: formatShortDate(group.expiry_date) })}
            </span>
          )}
          {group.lot_number && <span className={s.cardLotNumberPill}>{group.lot_number}</span>}
        </>
      }
      trailing={children}
      {...rest}
    />
  )
}
