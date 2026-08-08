import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import LotRow, { LotQty, LotRowList, LotRowShell } from './LotRow'
import cx from '../utils/cx'
import { groupLots } from '../utils/lotsForSelection'
import buttons from '../styles/buttons.module.css'
import s from './StockLotsList.module.css'

/**
 * The grouped lots of a stock, as rendered in the stock detail.
 *
 * Rows are groups, not database rows: several boxes of the same batch collapse
 * into one line that expands to show each physical pack by its serial. The
 * component owns the expansion — a way to look inside a row, not state worth
 * persisting — and nothing else. Deleting is the caller's business: it receives
 * the lot and decides what to ask before removing it.
 *
 * Layout comes from `LotRow`: group rows are `LotRow` itself, pack rows share
 * its skeleton (`LotRowShell`) but not its content — a pack shows a serial
 * where a group shows expiry and batch, which makes it a different row rather
 * than a variant.
 *
 * Props:
 *   lots         — raw lots as the API returns them (`stock.lots`)
 *   today        — local-midnight date, so expiry severity matches the backend's
 *                  `date.today()` semantics (a lot expiring today reads as
 *                  'reached'). Passed in rather than computed here so the page
 *                  and this list can never disagree by a millisecond.
 *   reachable    — from `useServerReachable()`; gates the delete affordance
 *   onRemoveLot  — called with the full lot row (needs `id` and `updated_at`)
 */
export default function StockLotsList({ lots, today, reachable, onRemoveLot }) {
  const { t } = useTranslation()

  // Keys of the lot groups whose individual boxes are on screen. Purely local:
  // the expansion is a way to look inside a row, not state worth persisting.
  const [expandedGroups, setExpandedGroups] = useState([])

  const toggleGroup = (key) =>
    setExpandedGroups((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))

  // `minQuantity: 0` — the detail list shows exactly what the server sent,
  // where the consumption modals only offer lots with units left.
  const lotGroups = groupLots(lots ?? [], { minQuantity: 0 })

  if (lotGroups.length === 0) return null

  const deleteButton = (lot) => (
    <button
      type="button"
      className={cx(buttons.btnIcon, buttons.btnIconDelete, !reachable && buttons.disabled)}
      onClick={() => onRemoveLot(lot)}
      aria-disabled={!reachable}
      aria-label={t('inventory.deleteTooltip')}
      title={!reachable ? t('offline.pageUnavailable') : t('inventory.deleteTooltip')}
    >
      <Icon name="trash" size="sm" />
    </button>
  )

  return (
    <LotRowList lots={lots} trailing className={s.lotsList}>
      {lotGroups.map((group) => {
        // Several rows sharing lot number and expiry are several physical
        // boxes: the group collapses them and expands to show each one by its
        // serial.
        //
        // A group of exactly one *identified* box is expandable too, even
        // though there is nothing to collapse. Otherwise its trailing control
        // is the delete button and the serial has nowhere to appear — so the
        // last remaining box of a batch becomes impossible to look up, which
        // is the opposite of what a serial is for.
        const isExpandable = group.rows.length > 1 || group.rows.some((row) => row.serial_number)
        const expanded = expandedGroups.includes(group.key)
        return (
          <Fragment key={group.key}>
            <LotRow group={group} today={today} testId="lot-row">
              {isExpandable ? (
                <button
                  type="button"
                  className={cx(buttons.btnIcon, s.groupExpander)}
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={expanded}
                  aria-label={t('stockDetail.togglePacks')}
                  title={t('stockDetail.togglePacks')}
                  data-testid="group-expander"
                >
                  {/* The bare count replaces a "· N packs" caption in the
                      lot pill: on a phone that caption pushed the row into
                      two lines, and the chevron already says "expandable". */}
                  <span className={s.packCount}>{group.rows.length}</span>
                  <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" />
                </button>
              ) : (
                deleteButton(group.rows[0])
              )}
            </LotRow>
            {isExpandable &&
              expanded &&
              group.rows.map((lot) => (
                <LotRowShell
                  key={lot.id}
                  testId="pack-row"
                  className={s.packRow}
                  data-lot-id={lot.id}
                  main={
                    <LotQty>
                      {lot.quantity} {t('common.unit')}
                    </LotQty>
                  }
                  meta={
                    /* No "Serial" prefix here: every row in an expanded group
                       is one physical pack, so the word only repeats what the
                       list already says. The modals keep it — there the packs
                       are mixed in with other choices. */
                    <span className={cx(s.packSerial, lot.serial_number && s.packSerialCode)}>
                      {lot.serial_number || t('lot.modal.unidentifiedUnits')}
                    </span>
                  }
                  trailing={deleteButton(lot)}
                />
              ))}
          </Fragment>
        )
      })}
    </LotRowList>
  )
}
