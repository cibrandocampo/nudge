import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import AlertBanner from '../components/AlertBanner'
import ConfirmModal from '../components/ConfirmModal'
import EditToggle from '../components/EditToggle'
import Icon from '../components/Icon'
import Spinner from '../components/Spinner'
import { useEditMode } from '../hooks/useEditMode'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useStockGroups } from '../hooks/useStock'
import { useCreateStockGroup } from '../hooks/mutations/useCreateStockGroup'
import { useDeleteStockGroup } from '../hooks/mutations/useDeleteStockGroup'
import { useUpdateStockGroup } from '../hooks/mutations/useUpdateStockGroup'
import { useServerReachable } from '../hooks/useServerReachable'
import { useToast } from '../components/useToast'
import cx from '../utils/cx'
import buttons from '../styles/buttons.module.css'
import forms from '../styles/forms.module.css'
import layout from '../styles/layout.module.css'
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
  // Local mirror of the server list so a move shows at once, before the
  // PATCH responses land.
  const [localOrder, setLocalOrder] = useState(null)
  const { showToast } = useToast()
  // «Edit» mode (T153 pattern): delete and Up/Down only while editing. Up/Down
  // replace the drag-and-drop reorder (T154, UX-017): HTML5 drag never worked
  // with a finger on Android and had no keyboard path.
  const groupsEdit = useEditMode({ count: groups.length })
  // After a move, the focus goes back to the moved category's control in its
  // new row (`{ id, dir }`), and the live region says where it landed.
  const [pendingFocus, setPendingFocus] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const moveRefs = useRef(new Map())

  // Moves still waiting for their PATCHes. The local mirror stays on screen
  // until the last one settles: each PATCH's success updates its category in
  // the cache in place, and dropping the mirror on that change (as this page
  // did with the drag) showed the cache mid-sequence — a second move made
  // quickly undid the first on screen (T154 E2E).
  const pendingMoves = useRef(0)

  // The list is always shown by `display_order`, never by the cache's array
  // order, which in-place updates leave unsorted.
  const orderedGroups = localOrder ?? [...groups].sort((a, b) => a.display_order - b.display_order)

  useLayoutEffect(() => {
    if (!pendingFocus) return
    const { id, dir } = pendingFocus
    const index = orderedGroups.findIndex((g) => g.id === id)
    // At an end its own button is unavailable: the other one keeps the focus
    // on the moved category.
    const atEnd = dir === 'up' ? index === 0 : index === orderedGroups.length - 1
    const target = moveRefs.current.get(`${id}-${atEnd ? (dir === 'up' ? 'down' : 'up') : dir}`)
    target?.focus()
    setPendingFocus(null)
  }, [pendingFocus, orderedGroups])

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
    // Only PATCH groups whose display_order actually changes: a swap is two.
    const diffs = newOrder
      .map((g, idx) => ({ id: g.id, name: g.name, displayOrder: idx, prev: g.display_order }))
      .filter((d) => d.prev !== d.displayOrder)
    try {
      await Promise.all(
        diffs.map((d) =>
          updateGroup.mutateAsync({ groupId: d.id, groupName: d.name, patch: { display_order: d.displayOrder } }),
        ),
      )
      setActionError(null)
    } catch {
      // The mirror is dropped when the last pending move settles (`move`);
      // the refetch the mutation triggers brings the server's order back.
      setActionError(t('stockGroups.errorReorder'))
    }
  }

  // Swap a category with its neighbour. Two PATCHes at most: only the two
  // rows whose `display_order` changes are sent.
  const move = async (groupId, dir) => {
    // Only reachable from a row's own button, which is unavailable at an end.
    const from = orderedGroups.findIndex((g) => g.id === groupId)
    const to = dir === 'up' ? from - 1 : from + 1
    const next = [...orderedGroups]
    ;[next[from], next[to]] = [next[to], next[from]]
    setLocalOrder(next.map((g, index) => ({ ...g, display_order: index })))
    setPendingFocus({ id: groupId, dir })
    setAnnouncement(t('stockGroups.moved', { name: next[to].name, position: to + 1, total: next.length }))
    pendingMoves.current += 1
    try {
      await persistReorder(next)
    } finally {
      pendingMoves.current -= 1
      if (pendingMoves.current === 0) setLocalOrder(null)
    }
  }

  return (
    <div>
      <div className={layout.topBar}>
        <button type="button" className={cx(buttons.btn, buttons.text, s.back)} onClick={() => navigate('/inventory')}>
          {t('common.backToInventory')}
        </button>
        <h1 className={layout.pageTitle}>{t('stockGroups.title')}</h1>
      </div>

      {!reachable && (
        <AlertBanner variant="warning" icon="wifi-off">
          {t('offline.settingsBlock')}
        </AlertBanner>
      )}

      {isLoading ? (
        <Spinner />
      ) : orderedGroups.length === 0 ? (
        <p className={s.empty}>{t('stockGroups.empty')}</p>
      ) : (
        <>
          <div className={s.listHeader}>
            <EditToggle
              section={t('stockGroups.title')}
              editing={groupsEdit.editing}
              onToggle={groupsEdit.toggle}
              controls="stock-groups"
              reachable={reachable}
              offlineTitle={t('offline.requiresConnection')}
              onOffline={() => showToast({ type: 'error', message: t('offline.requiresConnection') })}
            />
          </div>
          <ul id="stock-groups" className={s.list}>
            {orderedGroups.map((group, index) => {
              const first = index === 0
              const last = index === orderedGroups.length - 1
              const moveButton = (dir, unavailable) => (
                <button
                  type="button"
                  ref={(el) => {
                    if (el) moveRefs.current.set(`${group.id}-${dir}`, el)
                    else moveRefs.current.delete(`${group.id}-${dir}`)
                  }}
                  className={cx(buttons.icon, buttons.outlined, unavailable && buttons.disabled)}
                  onClick={() => !unavailable && move(group.id, dir)}
                  // `aria-disabled`, not `disabled`: the button at an end keeps
                  // its place in the tab order, so the focus never drops out
                  // of the list after a move lands it there.
                  aria-disabled={unavailable || undefined}
                  aria-label={t(dir === 'up' ? 'stockGroups.moveUp' : 'stockGroups.moveDown', { name: group.name })}
                  data-testid={`move-${dir}`}
                >
                  <Icon name={dir === 'up' ? 'chevron-up' : 'chevron-down'} size="sm" />
                </button>
              )
              return (
                <li key={group.id} className={s.row} data-testid="group-row">
                  {groupsEdit.editing && (
                    <div className={s.moveButtons}>
                      {moveButton('up', first)}
                      {moveButton('down', last)}
                    </div>
                  )}
                  {editing?.id === group.id ? (
                    <input
                      className={cx(forms.input, s.nameInput)}
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
                    {groupsEdit.editing ? (
                      <button
                        type="button"
                        className={cx(buttons.icon, buttons.outlined, buttons.iconDanger)}
                        onClick={() => setConfirmDelete({ id: group.id, name: group.name })}
                        disabled={!reachable}
                        aria-label={t('stockGroups.deleteNamed', { name: group.name })}
                        title={!reachable ? t('offline.requiresConnection') : undefined}
                        data-testid="row-delete"
                      >
                        <Icon name="trash" size="sm" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={cx(buttons.icon, buttons.outlined)}
                        onClick={() => setEditing({ id: group.id })}
                        disabled={!reachable || editing?.id === group.id}
                        aria-label={t('stockGroups.renameNamed', { name: group.name })}
                        title={!reachable ? t('offline.requiresConnection') : undefined}
                        data-testid="group-rename"
                      >
                        <Icon name="pencil" size="sm" />
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          {/* Where a moved category landed, for screen readers (T154). */}
          <p className={layout.srOnly} aria-live="polite" data-testid="move-announcement">
            {announcement}
          </p>
        </>
      )}

      <form onSubmit={handleCreate} className={s.createForm}>
        <input
          className={cx(forms.input, s.createInput)}
          placeholder={t('stockGroups.createPlaceholder')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          disabled={!reachable}
          aria-label={t('stockGroups.createPlaceholder')}
        />
        <button
          type="submit"
          className={cx(buttons.icon, buttons.iconFilled)}
          disabled={createGroup.isPending || !reachable || !newName.trim()}
          aria-label={t('stockGroups.createButton')}
          title={!reachable ? t('offline.requiresConnection') : t('stockGroups.createButton')}
        >
          <Icon name="plus" />
        </button>
      </form>

      {actionError && <p className={cx(forms.error, s.error)}>{actionError}</p>}

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
