import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EmptyCard from '../components/EmptyCard'
import Icon from '../components/Icon'
import LotPickerModal from '../components/LotPickerModal'
import Spinner from '../components/Spinner'
import StockAlertCard, { StockAlertBadge } from '../components/StockAlertCard'
import StockCard from '../components/StockCard'
import { useToast } from '../components/useToast'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockGroups, useStockList } from '../hooks/useStock'
import cx from '../utils/cx'
import { effectiveGroupId } from '../utils/stockGroup'
import { lotExpirySeverity } from '../utils/stockSeverity'
import { formatShortDate } from '../utils/time'
import buttons from '../styles/buttons.module.css'
import cards from '../styles/cards.module.css'
import layout from '../styles/layout.module.css'
import s from './InventoryPage.module.css'

// Partition a stock's lots into reached / soon buckets in a single pass.
// Replaces the dropped `expiring_lots` server-side field (T170): the alert
// blocks now derive their content from `stock.lots` directly so we don't
// duplicate per-lot data in the API response.
function lotsByExpirySeverity(stock, today) {
  const reached = []
  const soon = []
  for (const lot of stock.lots ?? []) {
    if (lot.quantity <= 0) continue
    const sev = lotExpirySeverity(lot, today)
    if (sev === 'reached') reached.push(lot)
    else if (sev === 'soon') soon.push(lot)
  }
  return { reached, soon }
}

export default function InventoryPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const { data: stocks = [], isLoading } = useStockList()
  const { data: groups = [] } = useStockGroups()
  const reachable = useServerReachable()

  // Which stock's picker is currently open (−1 consume flow). The picker
  // itself owns the consumption mutation; this state is just "which card
  // spawned it".
  const [pickerStock, setPickerStock] = useState(null)
  const [consumingId, setConsumingId] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const [collapsed, setCollapsed] = useState({})

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

  const toggleCollapse = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  if (isLoading) return <Spinner />

  // UTC midnight of today for the `lotExpirySeverity` helper. Mirrors the
  // pattern used by StockCard / StockDetailPage so all three call sites use
  // the same `today` semantics.
  const today = new Date(new Date().toISOString().slice(0, 10))
  // T168: 'critical' replaces 'out' and absorbs every red case
  // (qty_available=0, all-expired, depletion < 7d). One alert block per A2.
  const criticalStockItems = stocks.filter((st) => st.stock_severity === 'critical')
  const expiryReachedItems = stocks.filter((st) => st.expiry_severity === 'reached')
  const lowStockItems = stocks.filter((st) => st.stock_severity === 'low')
  const expiringSoonItems = stocks.filter((st) => st.expiry_severity === 'soon')
  const hasAlerts =
    criticalStockItems.length > 0 ||
    expiryReachedItems.length > 0 ||
    lowStockItems.length > 0 ||
    expiringSoonItems.length > 0

  const knownGroupIds = new Set(groups.map((g) => g.id))
  const groupedSections = groups.map((group) => ({
    key: group.id,
    label: group.name,
    stocks: stocks.filter((st) => effectiveGroupId(st) === group.id),
  }))
  const ungroupedStocks = stocks.filter((st) => {
    const gid = effectiveGroupId(st)
    return !gid || !knownGroupIds.has(gid)
  })

  const renderStockCard = (stock) => (
    <StockCard
      key={stock.id}
      stock={stock}
      consuming={consumingId === stock.id}
      flashing={flashId === stock.id}
      onConsume={handleConsume}
    />
  )

  return (
    <div>
      <div className={layout.topBar}>
        <h1 className={layout.pageTitle}>{t('inventory.title')}</h1>
        <div className={s.topActions}>
          <button
            type="button"
            className={cx(buttons.btnAdd, buttons.btnAddSecondary)}
            onClick={() => navigate('/inventory/groups')}
            aria-label={t('inventory.manageGroups')}
            title={t('inventory.manageGroups')}
          >
            <Icon name="tag" />
          </button>
          <button
            type="button"
            className={cx(buttons.btnAdd, !reachable && buttons.disabled)}
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

      {hasAlerts && (
        <div className={cards.alertsSection} data-testid="alert-box">
          {/* Red — critical stock (qty_available=0, all expired, or depletion < 7d) */}
          {criticalStockItems.length > 0 && (
            <StockAlertCard variant="danger" title={t('inventory.criticalStockAlert')} testId="critical-stock-alert">
              {criticalStockItems.map((st) => (
                <StockAlertBadge key={st.id} variant="danger">
                  {t('inventory.criticalStockItem', {
                    name: st.name,
                    qty: st.quantity_available ?? st.quantity ?? 0,
                  })}
                </StockAlertBadge>
              ))}
            </StockAlertCard>
          )}

          {/* Red — expiry already reached */}
          {expiryReachedItems.length > 0 && (
            <StockAlertCard variant="danger" title={t('inventory.expiryReachedAlert')} testId="expiry-reached-alert">
              {expiryReachedItems.flatMap((st) =>
                lotsByExpirySeverity(st, today).reached.map((lot) => (
                  <StockAlertBadge
                    key={`${st.id}-${lot.id}`}
                    variant="danger"
                    tail={t('inventory.expiryReachedSince', { date: formatShortDate(lot.expiry_date) })}
                  >
                    {t('inventory.expiryReachedItem', { name: st.name, qty: lot.quantity })}
                  </StockAlertBadge>
                )),
              )}
            </StockAlertCard>
          )}

          {/* Orange — low stock */}
          {lowStockItems.length > 0 && (
            <StockAlertCard variant="warning" title={t('inventory.lowStockAlert')} testId="low-stock-alert">
              {lowStockItems.map((st) => (
                <StockAlertBadge
                  key={st.id}
                  variant="warning"
                  tail={
                    st.estimated_depletion_date &&
                    t('inventory.lowStockItemUntil', { date: formatShortDate(st.estimated_depletion_date) })
                  }
                >
                  {t('inventory.lowStockItem', { name: st.name, qty: st.quantity })}
                </StockAlertBadge>
              ))}
            </StockAlertCard>
          )}

          {/* Orange — expiring soon (within 30 days) */}
          {expiringSoonItems.length > 0 && (
            <StockAlertCard variant="warning" title={t('inventory.expiringSoonAlert')} testId="expiring-soon-alert">
              {expiringSoonItems.flatMap((st) =>
                lotsByExpirySeverity(st, today).soon.map((lot) => (
                  <StockAlertBadge
                    key={`${st.id}-${lot.id}`}
                    variant="warning"
                    tail={t('inventory.expiringSoonItemUntil', { date: formatShortDate(lot.expiry_date) })}
                  >
                    {t('inventory.expiringSoonItem', { name: st.name, qty: lot.quantity })}
                  </StockAlertBadge>
                )),
              )}
            </StockAlertCard>
          )}
        </div>
      )}

      {stocks.length === 0 && <EmptyCard title={t('inventory.emptyTitle')} message={t('inventory.emptyBody')} />}

      {groupedSections.map(
        (section) =>
          section.stocks.length > 0 && (
            <div key={section.key} className={cards.group} data-testid="group-box">
              <button type="button" className={cards.groupHeader} onClick={() => toggleCollapse(section.key)}>
                <Icon name={collapsed[section.key] ? 'chevron-right' : 'chevron-down'} size="sm" />
                <span className={cards.groupName}>{section.label}</span>
                <span className={cards.groupCount}>({section.stocks.length})</span>
              </button>
              {!collapsed[section.key] && section.stocks.map(renderStockCard)}
            </div>
          ),
      )}

      {ungroupedStocks.map(renderStockCard)}

      {pickerStock && (
        <LotPickerModal
          stock={pickerStock}
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
