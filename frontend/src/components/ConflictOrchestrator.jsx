import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { useQueueEntries } from '../hooks/useQueueEntries'
import { enqueue, remove } from '../offline/queue'
import { forceSync } from '../offline/sync'
import ConflictModal from './ConflictModal'

/**
 * Watches the offline queue for the first entry in `conflict` state and
 * opens `<ConflictModal/>` for it. Tracks resolved-or-dismissed entries so
 * the modal doesn't re-open after the user closed it without choosing.
 *
 * Mounted once from App.jsx so any 412 detected by the sync worker anywhere
 * in the app surfaces the modal.
 */
export default function ConflictOrchestrator() {
  const entries = useQueueEntries()
  const queryClient = useQueryClient()
  const [dismissedId, setDismissedId] = useState(null)

  const conflict = entries.find((e) => e.status === 'conflict' && e.id !== dismissedId)

  if (!conflict) return null

  const handleClose = () => {
    setDismissedId(conflict.id)
  }

  const handleUseServer = async () => {
    // The server's state is the truth: invalidate the cache so every
    // consumer refetches. TanStack Query already holds the NetworkFirst
    // SW response (T025) as the freshest snapshot.
    await remove(conflict.id)
    await queryClient.invalidateQueries()
    setDismissedId(null)
  }

  const handleKeepMine = async () => {
    // Re-issue the mutation with the server's latest updated_at and a new
    // Idempotency-Key. The old key already cached a 412 in the backend's
    // IdempotencyRecord, so reusing it would just replay the conflict.
    const newUpdatedAt = conflict.conflictCurrent?.updated_at ?? conflict.conflictCurrent?.settings_updated_at ?? null
    await remove(conflict.id)
    await enqueue({
      id: uuidv4(),
      method: conflict.method,
      endpoint: conflict.endpoint,
      body: conflict.body,
      resourceKey: conflict.resourceKey ?? null,
      ifUnmodifiedSince: newUpdatedAt,
      createdAt: new Date().toISOString(),
      status: 'pending',
    })
    await forceSync()
    setDismissedId(null)
  }

  return (
    <ConflictModal
      mutation={conflict}
      onKeepMine={handleKeepMine}
      onUseServer={handleUseServer}
      onClose={handleClose}
    />
  )
}
