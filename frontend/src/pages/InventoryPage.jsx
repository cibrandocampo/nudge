import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EmptyCard from '../components/EmptyCard'
import Icon from '../components/Icon'
import LotPickerModal from '../components/LotPickerModal'
import StockCard from '../components/StockCard'
import { useToast } from '../components/useToast'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockGroups, useStockList } from '../hooks/useStock'
import cx from '../utils/cx'
import { formatShortDate } from '../utils/time'
import shared from '../styles/shared.module.css'
import s from './InventoryPage.module.css'

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

  if (isLoading) return <div className={shared.spinner} data-testid="spinner" />

  const todayISO = new Date().toISOString().slice(0, 10)
  const outOfStockItems = stocks.filter((st) => st.stock_severity === 'out')
  const expiryReachedItems = stocks.filter((st) => st.expiry_severity === 'reached')
  const lowStockItems = stocks.filter((st) => st.stock_severity === 'low')
  const expiringSoonItems = stocks.filter((st) => st.expiry_severity === 'soon')
  const hasAlerts =
    outOfStockItems.length > 0 ||
    expiryReachedItems.length > 0 ||
    lowStockItems.length > 0 ||
    expiringSoonItems.length > 0

  const knownGroupIds = new Set(groups.map((g) => g.id))
  const groupedSections = groups.map((group) => ({
    key: group.id,
    label: group.name,
    stocks: stocks.filter((st) => st.group === group.id),
  }))
  const ungroupedStocks = stocks.filter((st) => !st.group || !knownGroupIds.has(st.group))

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
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('inventory.title')}</h1>
        <div className={s.topActions}>
          <button
            type="button"
            className={cx(shared.btnAdd, shared.btnAddSecondary)}
            onClick={() => navigate('/inventory/groups')}
            aria-label={t('inventory.manageGroups')}
            title={t('inventory.manageGroups')}
          >
            <Icon name="tag" />
          </button>
          <button
            type="button"
            className={cx(shared.btnAdd, !reachable && shared.disabled)}
            onClick={() => navigate('/inventory/new')}
            aria-label={t('inventory.newButton')}
            disabled={!reachable}
            title={!reachable ? t('offline.requiresConnection') : t('inventory.newButton')}
          >
            <Icon name="plus" />
          </button>
        </div>
      </div>

      {hasAlerts && (
        <div className={shared.alertsSection} data-testid="alert-box">
          {/* Red — out of stock */}
          {outOfStockItems.length > 0 && (
            <div className={cx(shared.card, shared.cardBorderDanger)} data-testid="out-of-stock-alert">
              <div className={shared.cardHeader}>
                <div className={shared.cardMeta}>
                  <div className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                    <span className={cx(shared.dot, shared.dotDanger)} />
                    {t('inventory.outOfStockAlert')}
                  </div>
                  {outOfStockItems.map((st) => (
                    <span key={st.id} className={shared.cardStockBadge}>
                      <Icon name="package" size="sm" />
                      <span>{t('inventory.outOfStockItem', { name: st.name })}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Red — expiry already reached */}
          {expiryReachedItems.length > 0 && (
            <div className={cx(shared.card, shared.cardBorderDanger)} data-testid="expiry-reached-alert">
              <div className={shared.cardHeader}>
                <div className={shared.cardMeta}>
                  <div className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                    <span className={cx(shared.dot, shared.dotDanger)} />
                    {t('inventory.expiryReachedAlert')}
                  </div>
                  {expiryReachedItems.flatMap((st) =>
                    (st.expiring_lots ?? [])
                      .filter((lot) => lot.expiry_date && lot.expiry_date <= todayISO)
                      .map((lot) => (
                        <span key={`${st.id}-${lot.id}`} className={shared.cardStockBadge}>
                          <Icon name="package" size="sm" />
                          <span>
                            {t('inventory.expiryReachedItem', { name: st.name, qty: lot.quantity })}
                          </span>
                          <span className={shared.stockDepletionDanger}>
                            {' '}
                            {t('inventory.expiryReachedSince', {
                              date: formatShortDate(lot.expiry_date, { withDay: false }),
                            })}
                          </span>
                        </span>
                      )),
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Orange — low stock */}
          {lowStockItems.length > 0 && (
            <div className={cx(shared.card, shared.cardBorderWarning)} data-testid="low-stock-alert">
              <div className={shared.cardHeader}>
                <div className={shared.cardMeta}>
                  <div className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                    <span className={cx(shared.dot, shared.dotWarning)} />
                    {t('inventory.lowStockAlert')}
                  </div>
                  {lowStockItems.map((st) => (
                    <span key={st.id} className={shared.cardStockBadge}>
                      <Icon name="package" size="sm" />
                      <span>{t('inventory.lowStockItem', { name: st.name, qty: st.quantity })}</span>
                      {st.estimated_depletion_date && (
                        <span className={shared.stockDepletionWarn}>
                          {' '}
                          {t('inventory.lowStockItemUntil', {
                            date: formatShortDate(st.estimated_depletion_date),
                          })}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Orange — expiring soon (within 30 days) */}
          {expiringSoonItems.length > 0 && (
            <div className={cx(shared.card, shared.cardBorderWarning)} data-testid="expiring-soon-alert">
              <div className={shared.cardHeader}>
                <div className={shared.cardMeta}>
                  <div className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                    <span className={cx(shared.dot, shared.dotWarning)} />
                    {t('inventory.expiringSoonAlert')}
                  </div>
                  {expiringSoonItems.flatMap((st) =>
                    (st.expiring_lots ?? [])
                      .filter((lot) => lot.expiry_date && lot.expiry_date > todayISO)
                      .map((lot) => (
                        <span key={`${st.id}-${lot.id}`} className={shared.cardStockBadge}>
                          <Icon name="package" size="sm" />
                          <span>
                            {t('inventory.expiringSoonItem', { name: st.name, qty: lot.quantity })}
                          </span>
                          <span className={shared.stockDepletionWarn}>
                            {' '}
                            {t('inventory.expiringSoonItemUntil', {
                              date: formatShortDate(lot.expiry_date, { withDay: false }),
                            })}
                          </span>
                        </span>
                      )),
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {stocks.length === 0 && <EmptyCard title={t('inventory.emptyTitle')} message={t('inventory.emptyBody')} />}

      {groupedSections.map(
        (section) =>
          section.stocks.length > 0 && (
            <div key={section.key} className={shared.group} data-testid="group-box">
              <button type="button" className={shared.groupHeader} onClick={() => toggleCollapse(section.key)}>
                <Icon name={collapsed[section.key] ? 'chevron-right' : 'chevron-down'} size="sm" />
                <span className={shared.groupName}>{section.label}</span>
                <span className={shared.groupCount}>({section.stocks.length})</span>
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
