import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import AlertBanner from '../components/AlertBanner'
import ConfirmModal from '../components/ConfirmModal'
import GroupPickerModal from '../components/GroupPickerModal'
import Icon from '../components/Icon'
import LotSelectionModal from '../components/LotSelectionModal'
import ShareModal from '../components/ShareModal'
import StockCard from '../components/StockCard'
import { useToast } from '../components/useToast'
import { useContacts } from '../hooks/useContacts'
import { useServerReachable } from '../hooks/useServerReachable'
import { useStockGroups, useStockList } from '../hooks/useStock'
import { useConsumeStock } from '../hooks/mutations/useConsumeStock'
import { useCreateStock } from '../hooks/mutations/useCreateStock'
import { useCreateStockGroup } from '../hooks/mutations/useCreateStockGroup'
import { useCreateStockLot } from '../hooks/mutations/useCreateStockLot'
import { useDeleteStockGroup } from '../hooks/mutations/useDeleteStockGroup'
import { useDeleteStockLot } from '../hooks/mutations/useDeleteStockLot'
import { useUpdateStock } from '../hooks/mutations/useUpdateStock'
import { useUpdateStockGroup } from '../hooks/mutations/useUpdateStockGroup'
import { OfflineError } from '../api/errors'
import cx from '../utils/cx'
import { lotsForSelection } from '../utils/lotsForSelection'
import shared from '../styles/shared.module.css'
import s from './InventoryPage.module.css'

function formatExpiry(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatDepletionDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatRate(rate) {
  return rate % 1 === 0 ? String(rate) : rate.toFixed(1)
}

export default function InventoryPage() {
  const { t } = useTranslation()
  const { showToast } = useToast()

  const { data: stocks = [], isLoading } = useStockList()
  const { data: groups = [] } = useStockGroups()
  const { data: contacts = [] } = useContacts()
  const reachable = useServerReachable()

  const createStock = useCreateStock()
  const updateStock = useUpdateStock()
  const createLot = useCreateStockLot()
  const deleteLot = useDeleteStockLot()
  const consumeStock = useConsumeStock()
  const createGroup = useCreateStockGroup()
  const updateGroup = useUpdateStockGroup()
  const deleteGroup = useDeleteStockGroup()

  const [confirmRemoveLot, setConfirmRemoveLot] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [consuming, setConsuming] = useState(null)
  const [lotModal, setLotModal] = useState(null)
  const [flashId, setFlashId] = useState(null)
  const [addLot, setAddLot] = useState({})
  const [collapsed, setCollapsed] = useState({})
  const [showGroupManager, setShowGroupManager] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroup, setEditingGroup] = useState(null)
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null)
  const [groupPickerOpen, setGroupPickerOpen] = useState(null)
  const [shareStockId, setShareStockId] = useState(null)

  const notifyError = (err) => {
    const message = err instanceof OfflineError ? t('offline.actionUnavailable') : t('common.actionError')
    showToast({ type: 'error', message })
  }

  const create = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    try {
      await createStock.mutateAsync({ name: newName.trim() })
      setNewName('')
      setShowNew(false)
    } catch (err) {
      notifyError(err)
    }
  }

  const doConsume = async (stockId, lotSelections) => {
    setConsuming(stockId)
    try {
      await consumeStock.mutateAsync({
        stockId,
        quantity: 1,
        lotSelections,
      })
      setFlashId(stockId)
      setTimeout(() => setFlashId(null), 600)
    } catch (err) {
      notifyError(err)
    } finally {
      setConsuming(null)
    }
  }

  const handleConsume = async (stock) => {
    if (consuming) return
    if (stock.requires_lot_selection) {
      // The stock object already carries its lots array — derive the
      // FEFO selection locally instead of hitting a separate endpoint.
      const lots = lotsForSelection(stock)
      if (lots.length === 0) {
        showToast({ type: 'error', message: t('common.actionError') })
        return
      }
      setLotModal({ stockId: stock.id, lots })
      return
    }
    await doConsume(stock.id)
  }

  const handleLotConfirm = async (lotSelections) => {
    const { stockId } = lotModal
    setLotModal(null)
    await doConsume(stockId, lotSelections)
  }

  const lotForm = (stockId) => addLot[stockId] ?? { show: false, qty: '', expiry: '', lotNumber: '', adding: false }

  const setLotField = (stockId, field, value) =>
    setAddLot((prev) => ({ ...prev, [stockId]: { ...lotForm(stockId), [field]: value } }))

  const toggleAddLot = (stockId) =>
    setAddLot((prev) => ({ ...prev, [stockId]: { ...lotForm(stockId), show: !lotForm(stockId).show } }))

  const submitAddLot = async (e, stockId) => {
    e.preventDefault()
    const form = lotForm(stockId)
    const qty = parseInt(form.qty, 10)
    if (isNaN(qty) || qty < 0) return
    setLotField(stockId, 'adding', true)
    try {
      await createLot.mutateAsync({
        stockId,
        quantity: qty,
        expiryDate: form.expiry,
        lotNumber: form.lotNumber.trim(),
      })
      setAddLot((prev) => ({ ...prev, [stockId]: { show: false, qty: '', expiry: '', lotNumber: '', adding: false } }))
    } catch (err) {
      setLotField(stockId, 'adding', false)
      notifyError(err)
    }
  }

  const doRemoveLot = async () => {
    const { stockId, lotId, updatedAt } = confirmRemoveLot
    setConfirmRemoveLot(null)
    try {
      await deleteLot.mutateAsync({ stockId, lotId, updatedAt })
    } catch (err) {
      notifyError(err)
    }
  }

  const requestDeleteLot = (stockId, lotId, updatedAt) => {
    setConfirmRemoveLot({ stockId, lotId, updatedAt })
  }

  const handleAssignGroup = async (stockId, groupId) => {
    const stock = stocks.find((st) => st.id === stockId)
    try {
      await updateStock.mutateAsync({
        stockId,
        patch: { group: groupId },
        updatedAt: stock?.updated_at,
      })
    } catch (err) {
      notifyError(err)
    }
  }

  const handleToggleStockShare = async (userId) => {
    // ShareModal is only mounted when the stock for shareStockId exists,
    // so `stock` is always defined at this point.
    const stock = stocks.find((st) => st.id === shareStockId)
    const current = stock.shared_with || []
    const newShared = current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    try {
      await updateStock.mutateAsync({
        stockId: shareStockId,
        patch: { shared_with: newShared },
        updatedAt: stock.updated_at,
      })
    } catch (err) {
      notifyError(err)
    }
  }

  const handleCreateGroup = async (e) => {
    e.preventDefault()
    if (!newGroupName.trim()) return
    try {
      await createGroup.mutateAsync({ name: newGroupName.trim() })
      setNewGroupName('')
    } catch (err) {
      notifyError(err)
    }
  }

  const handleRenameGroup = async (id, name) => {
    setEditingGroup(null)
    if (!name.trim()) return
    try {
      await updateGroup.mutateAsync({ groupId: id, patch: { name: name.trim() } })
    } catch (err) {
      notifyError(err)
    }
  }

  const handleDeleteGroup = async () => {
    const { id } = confirmDeleteGroup
    setConfirmDeleteGroup(null)
    try {
      await deleteGroup.mutateAsync({ groupId: id })
    } catch (err) {
      notifyError(err)
    }
  }

  const handleMoveGroup = async (id, direction) => {
    // Callers are the per-row move buttons which are already disabled at
    // boundaries, so idx and swapIdx are guaranteed to be in range.
    const idx = groups.findIndex((g) => g.id === id)
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    const a = groups[idx]
    const b = groups[swapIdx]
    try {
      await Promise.all([
        updateGroup.mutateAsync({ groupId: a.id, patch: { display_order: b.display_order } }),
        updateGroup.mutateAsync({ groupId: b.id, patch: { display_order: a.display_order } }),
      ])
    } catch (err) {
      notifyError(err)
    }
  }

  const toggleCollapse = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  if (isLoading) return <div className={shared.spinner} data-testid="spinner" />

  const expiringStocks = stocks.filter((st) => st.has_expiring_lots)
  const lowStockItems = stocks.filter((st) => st.is_low_stock)
  const hasAlerts = expiringStocks.length > 0 || lowStockItems.length > 0

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
      consuming={consuming === stock.id}
      flashing={flashId === stock.id}
      canShare={contacts.length > 0}
      onConsume={handleConsume}
      onAssignGroup={setGroupPickerOpen}
      onToggleShare={setShareStockId}
      addLotForm={lotForm(stock.id)}
      onLotFieldChange={(field, value) => setLotField(stock.id, field, value)}
      onToggleAddLot={() => toggleAddLot(stock.id)}
      onSubmitAddLot={(e) => submitAddLot(e, stock.id)}
      onDeleteLot={requestDeleteLot}
    />
  )

  return (
    <div className={s.container}>
      <div className={shared.topBar}>
        <h1 className={shared.pageTitle}>{t('inventory.title')}</h1>
        <div className={s.topActions}>
          <button type="button" className={s.groupsBtn} onClick={() => setShowGroupManager(true)}>
            <Icon name="tag" size="sm" /> {t('inventory.manageGroups')}
          </button>
          <button
            type="button"
            className={cx(shared.btnAdd, !reachable && shared.disabled)}
            onClick={() => setShowNew((v) => !v)}
            aria-label={showNew ? t('inventory.cancel') : t('inventory.newButton')}
            disabled={!reachable}
            title={!reachable ? t('offline.requiresConnection') : undefined}
          >
            <Icon name={showNew ? 'x' : 'plus'} />
          </button>
        </div>
      </div>

      {showNew && (
        <form onSubmit={create} className={s.newForm}>
          <input
            className={shared.input}
            placeholder={t('inventory.namePlaceholder')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            required
          />
          <div className={s.newFormActions}>
            <button type="submit" className={s.createBtn} disabled={createStock.isPending}>
              {createStock.isPending ? t('inventory.creating') : t('inventory.createButton')}
            </button>
            <button type="button" className={s.cancelBtn} onClick={() => setShowNew(false)}>
              {t('inventory.cancel')}
            </button>
          </div>
        </form>
      )}

      {hasAlerts && (
        <div className={shared.alertsSection} data-testid="alert-box">
          {expiringStocks.length > 0 && (
            <div className={cx(shared.card, shared.cardBorderDanger)}>
              <div className={shared.cardHeader}>
                <div className={shared.cardMeta}>
                  <div className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                    <span className={cx(shared.dot, shared.dotDanger)} />
                    {t('inventory.expiringSoon')}
                  </div>
                  {expiringStocks.map((st) =>
                    st.expiring_lots.map((lot) => (
                      <div key={`${st.id}-${lot.id}`} className={shared.alertDetail}>
                        {st.name} —{' '}
                        {t('inventory.expiringLot', { qty: lot.quantity, date: formatExpiry(lot.expiry_date) })}
                      </div>
                    )),
                  )}
                </div>
              </div>
            </div>
          )}

          {lowStockItems.length > 0 && (
            <div className={cx(shared.card, shared.cardBorderWarning)} data-testid="low-stock-alert">
              <div className={shared.cardHeader}>
                <div className={shared.cardMeta}>
                  <div className={cx(shared.cardTitle, shared.cardTitleFlex)}>
                    <span className={cx(shared.dot, shared.dotWarning)} />
                    {t('inventory.lowStockAlert')}
                  </div>
                  {lowStockItems.map((st) => {
                    const totalRate = (st.daily_consumption_own || 0) + (st.daily_consumption_shared || 0)
                    return (
                      <div key={st.id} className={shared.alertDetail}>
                        {st.name} —{' '}
                        {t('inventory.lowStockItem', {
                          date: formatDepletionDate(st.estimated_depletion_date),
                          rate: formatRate(totalRate),
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {stocks.length === 0 && !showNew && <p className={shared.muted}>{t('inventory.empty')}</p>}

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

      {confirmRemoveLot && (
        <ConfirmModal
          message={t('inventory.confirmDeleteLot')}
          onConfirm={doRemoveLot}
          onCancel={() => setConfirmRemoveLot(null)}
          confirmLabel={t('inventory.deleteTooltip')}
        />
      )}

      {lotModal && (
        <LotSelectionModal
          routine={{ stock_usage: 1 }}
          lots={lotModal.lots}
          onConfirm={handleLotConfirm}
          onCancel={() => setLotModal(null)}
        />
      )}

      {showGroupManager && (
        <div className={shared.overlay} onClick={() => setShowGroupManager(false)} role="dialog" aria-modal="true">
          <div className={cx(shared.modalBox, s.groupManagerModal)} onClick={(e) => e.stopPropagation()}>
            <div className={s.groupManagerHeader}>
              <h2 className={s.groupManagerTitle}>{t('inventory.manageGroups')}</h2>
              <button
                type="button"
                className={cx(shared.btnIcon, shared.btnIconAction)}
                onClick={() => setShowGroupManager(false)}
                aria-label={t('common.close')}
              >
                <Icon name="x" size="sm" />
              </button>
            </div>

            {!reachable && (
              <AlertBanner variant="warning" icon="wifi-off">
                {t('offline.settingsBlock')}
              </AlertBanner>
            )}

            {groups.length === 0 && <p className={shared.muted}>{t('inventory.empty')}</p>}

            <div className={s.groupManagerList}>
              {groups.map((group, idx) => (
                <div key={group.id} className={s.groupManagerRow}>
                  {editingGroup?.id === group.id ? (
                    <input
                      className={shared.input}
                      defaultValue={group.name}
                      autoFocus
                      onBlur={(e) => handleRenameGroup(group.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameGroup(group.id, e.target.value)
                        if (e.key === 'Escape') setEditingGroup(null)
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={cx(s.groupManagerName, !reachable && shared.disabled)}
                      onClick={() => setEditingGroup({ id: group.id, name: group.name })}
                      disabled={!reachable}
                      title={!reachable ? t('offline.requiresConnection') : undefined}
                    >
                      {group.name}
                      <Icon name="edit" size="sm" className={s.editHint} />
                    </button>
                  )}
                  <div className={s.groupManagerActions}>
                    <button
                      type="button"
                      className={cx(shared.btnIcon, shared.btnIconAction)}
                      onClick={() => handleMoveGroup(group.id, 'up')}
                      disabled={idx === 0 || !reachable}
                      aria-label={t('inventory.moveUp')}
                      title={!reachable ? t('offline.requiresConnection') : t('inventory.moveUp')}
                    >
                      <Icon name="chevron-up" size="sm" />
                    </button>
                    <button
                      type="button"
                      className={cx(shared.btnIcon, shared.btnIconAction)}
                      onClick={() => handleMoveGroup(group.id, 'down')}
                      disabled={idx === groups.length - 1 || !reachable}
                      aria-label={t('inventory.moveDown')}
                      title={!reachable ? t('offline.requiresConnection') : t('inventory.moveDown')}
                    >
                      <Icon name="chevron-down" size="sm" />
                    </button>
                    <button
                      type="button"
                      className={cx(shared.btnIcon, shared.btnIconDelete)}
                      onClick={() => setConfirmDeleteGroup({ id: group.id, name: group.name })}
                      disabled={!reachable}
                      aria-label={t('inventory.deleteGroup')}
                      title={!reachable ? t('offline.requiresConnection') : t('inventory.deleteGroup')}
                    >
                      <Icon name="trash" size="sm" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleCreateGroup} className={s.groupManagerForm}>
              <input
                className={shared.input}
                placeholder={t('inventory.groupName')}
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                required
                disabled={!reachable}
              />
              <button
                type="submit"
                className={s.createBtn}
                disabled={createGroup.isPending || !reachable}
                title={!reachable ? t('offline.requiresConnection') : undefined}
              >
                {createGroup.isPending ? '…' : t('inventory.createGroup')}
              </button>
            </form>
          </div>
        </div>
      )}

      {groupPickerOpen && stocks.find((st) => st.id === groupPickerOpen) && (
        <GroupPickerModal
          groups={groups}
          currentGroupId={stocks.find((st) => st.id === groupPickerOpen).group}
          onSelect={(groupId) => {
            handleAssignGroup(groupPickerOpen, groupId)
            setGroupPickerOpen(null)
          }}
          onClose={() => setGroupPickerOpen(null)}
        />
      )}

      {shareStockId && stocks.find((st) => st.id === shareStockId) && (
        <ShareModal
          contacts={contacts}
          sharedWith={stocks.find((st) => st.id === shareStockId).shared_with}
          onToggle={handleToggleStockShare}
          onClose={() => setShareStockId(null)}
        />
      )}

      {confirmDeleteGroup && (
        <ConfirmModal
          message={t('inventory.confirmDeleteGroup', { name: confirmDeleteGroup.name })}
          onConfirm={handleDeleteGroup}
          onCancel={() => setConfirmDeleteGroup(null)}
          confirmLabel={t('inventory.deleteGroup')}
        />
      )}
    </div>
  )
}
