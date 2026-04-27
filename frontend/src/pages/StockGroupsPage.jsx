import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AlertBanner from '../components/AlertBanner'
import ConfirmModal from '../components/ConfirmModal'
import Icon from '../components/Icon'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useStockGroups } from '../hooks/useStock'
import { useCreateStockGroup } from '../hooks/mutations/useCreateStockGroup'
import { useDeleteStockGroup } from '../hooks/mutations/useDeleteStockGroup'
import { useUpdateStockGroup } from '../hooks/mutations/useUpdateStockGroup'
import { useServerReachable } from '../hooks/useServerReachable'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './StockGroupsPage.module.css'

export default function StockGroupsPage() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data: groups = [], isLoading } = useStockGroups()
  const createGroup = useCreateStockGroup()
  const updateGroup = useUpdateStockGroup()
  const deleteGroup = useDeleteStockGroup()
  const reachable = useServerReachable()

  const [editing, setEditing] = useState(null) // { id }
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null) // { id, name }
  const [actionError, setActionError] = useState(null)
  // Local mirror of the server list so we can reorder optimistically
  // before the PATCH responses land. Keeps the UI snappy under drag.
  const [localOrder, setLocalOrder] = useState(null)
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  // Sync local mirror whenever the server list changes. `null` means
  // "use the server list as-is".
  useEffect(() => {
    setLocalOrder(null)
  }, [groups])

  const orderedGroups = localOrder ?? groups

  // Cancel inline rename on Escape. Scoped to when a row is being edited.
  useEscapeKey(() => setEditing(null), editing != null)

  const commitRename = async (groupId, value) => {
    const trimmed = value.trim()
    setEditing(null)
    if (!trimmed) return
    const current = orderedGroups.find((g) => g.id === groupId)
    if (!current || current.name === trimmed) return
    try {
      await updateGroup.mutateAsync({ groupId, groupName: trimmed, patch: { name: trimmed } })
      setActionError(null)
    } catch {
      setActionError(t('stockGroups.errorRename'))
    }
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    const trimmed = newName.trim()
    if (!trimmed) return
    try {
      await createGroup.mutateAsync({ name: trimmed, displayOrder: orderedGroups.length })
      setNewName('')
      setActionError(null)
    } catch {
      setActionError(t('stockGroups.errorCreate'))
    }
  }

  const handleDelete = async () => {
    const { id, name } = confirmDelete
    setConfirmDelete(null)
    try {
      await deleteGroup.mutateAsync({ groupId: id, groupName: name })
      setActionError(null)
    } catch {
      setActionError(t('stockGroups.errorDelete'))
    }
  }

  const persistReorder = async (newOrder) => {
    // Only PATCH groups whose display_order would actually change.
    const diffs = newOrder
      .map((g, idx) => ({ id: g.id, name: g.name, displayOrder: idx, prev: g.display_order }))
      .filter((d) => d.prev !== d.displayOrder)
    if (diffs.length === 0) return
    try {
      await Promise.all(
        diffs.map((d) =>
          updateGroup.mutateAsync({ groupId: d.id, groupName: d.name, patch: { display_order: d.displayOrder } }),
        ),
      )
      setActionError(null)
    } catch {
      setActionError(t('stockGroups.errorReorder'))
      setLocalOrder(null)
    }
  }

  const handleDrop = async (targetId) => {
    const fromId = dragId
    setDragId(null)
    setDragOverId(null)
    if (fromId == null || fromId === targetId) return
    const source = orderedGroups
    const fromIdx = source.findIndex((g) => g.id === fromId)
    const toIdx = source.findIndex((g) => g.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return
    const next = [...source]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setLocalOrder(next)
    await persistReorder(next)
  }

  return (
    <div>
      <div className={shared.topBar}>
        <button type="button" className={s.back} onClick={() => navigate('/inventory')}>
          {t('common.backToInventory')}
        </button>
        <h1 className={shared.pageTitle}>{t('stockGroups.title')}</h1>
      </div>

      {!reachable && (
        <AlertBanner variant="warning" icon="wifi-off">
          {t('offline.settingsBlock')}
        </AlertBanner>
      )}

      {isLoading ? (
        <div className={shared.spinner} data-testid="spinner" />
      ) : orderedGroups.length === 0 ? (
        <p className={s.empty}>{t('stockGroups.empty')}</p>
      ) : (
        <ul className={s.list}>
          {orderedGroups.map((group) => {
            const isDragOver = dragOverId === group.id && dragId !== group.id
            return (
              <li
                key={group.id}
                className={cx(s.row, isDragOver && s.rowDragOver, dragId === group.id && s.rowDragging)}
                draggable={reachable && editing?.id !== group.id}
                onDragStart={(e) => {
                  setDragId(group.id)
                  e.dataTransfer.effectAllowed = 'move'
                  // Needed for Firefox to actually start the drag.
                  e.dataTransfer.setData('text/plain', String(group.id))
                }}
                onDragEnter={() => dragId != null && setDragOverId(group.id)}
                onDragOver={(e) => {
                  if (dragId != null) {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDragLeave={(e) => {
                  // Only clear when leaving the row entirely, not its children.
                  if (!e.currentTarget.contains(e.relatedTarget))
                    setDragOverId((cur) => (cur === group.id ? null : cur))
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDrop(group.id)
                }}
                onDragEnd={() => {
                  setDragId(null)
                  setDragOverId(null)
                }}
              >
                <span
                  className={cx(s.dragHandle, !reachable && shared.disabled)}
                  aria-label={t('stockGroups.dragHandle')}
                  title={!reachable ? t('offline.requiresConnection') : t('stockGroups.dragHandle')}
                >
                  <Icon name="grip-vertical" size="sm" />
                </span>
                {editing?.id === group.id ? (
                  <input
                    className={cx(shared.input, s.nameInput)}
                    defaultValue={group.name}
                    autoFocus
                    aria-label={t('stockGroups.rename')}
                    onBlur={(e) => commitRename(group.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(group.id, e.target.value)
                    }}
                  />
                ) : (
                  <span className={s.name}>{group.name}</span>
                )}
                <div className={s.actions}>
                  <button
                    type="button"
                    className={cx(shared.btnAdd, shared.btnAddDanger)}
                    onClick={() => setConfirmDelete({ id: group.id, name: group.name })}
                    disabled={!reachable}
                    aria-label={t('stockGroups.delete')}
                    title={!reachable ? t('offline.requiresConnection') : t('stockGroups.delete')}
                  >
                    <Icon name="trash" size="sm" />
                  </button>
                  <button
                    type="button"
                    className={shared.btnAdd}
                    onClick={() => setEditing({ id: group.id })}
                    disabled={!reachable || editing?.id === group.id}
                    aria-label={t('stockGroups.rename')}
                    title={!reachable ? t('offline.requiresConnection') : t('stockGroups.rename')}
                  >
                    <Icon name="pencil" size="sm" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={handleCreate} className={s.createForm}>
        <input
          className={cx(shared.input, s.createInput)}
          placeholder={t('stockGroups.createPlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={!reachable}
          aria-label={t('stockGroups.createPlaceholder')}
        />
        <button
          type="submit"
          className={shared.btnAdd}
          disabled={createGroup.isPending || !reachable || !newName.trim()}
          aria-label={t('stockGroups.createButton')}
          title={!reachable ? t('offline.requiresConnection') : t('stockGroups.createButton')}
        >
          <Icon name="plus" />
        </button>
      </form>

      {actionError && <p className={cx(shared.error, s.error)}>{actionError}</p>}

      {confirmDelete && (
        <ConfirmModal
          message={t('stockGroups.confirmDeleteBody', { name: confirmDelete.name })}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          confirmLabel={t('stockGroups.delete')}
        />
      )}
    </div>
  )
}
