import 'fake-indexeddb/auto'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { enqueue } from '../../offline/queue'
import { flushQueueReads } from '../../test/helpers'
import SyncStatusBadge from '../SyncStatusBadge'

function baseEntry(overrides = {}) {
  return {
    id: 'k-1',
    method: 'POST',
    endpoint: '/routines/5/log/',
    body: {},
    resourceKey: 'routine:5',
    ifUnmodifiedSince: null,
    createdAt: '2026-04-17T08:00:00Z',
    status: 'pending',
    ...overrides,
  }
}

// The global setup empties the queue before each test (src/test/setup.js).

describe('SyncStatusBadge', () => {
  it('renders nothing when no entries match the resource', async () => {
    const { container } = render(<SyncStatusBadge resourceKey="routine:5" />)
    await flushQueueReads()
    expect(container.firstChild).toBeNull()
  })

  it('shows the pending icon when the resource has a pending entry', async () => {
    await enqueue(baseEntry())
    render(<SyncStatusBadge resourceKey="routine:5" />)
    await waitFor(() => expect(screen.getByTestId('sync-status-badge')).toHaveAttribute('data-state', 'pending'))
    expect(screen.getByRole('status')).toHaveAccessibleName(/waiting/i)
  })

  it('prefers conflict over error/syncing/pending for the same resource', async () => {
    await enqueue(baseEntry({ id: 'p', status: 'pending' }))
    await enqueue(baseEntry({ id: 's', status: 'syncing' }))
    await enqueue(baseEntry({ id: 'e', status: 'error' }))
    await enqueue(baseEntry({ id: 'c', status: 'conflict' }))
    render(<SyncStatusBadge resourceKey="routine:5" />)
    await waitFor(() => expect(screen.getByTestId('sync-status-badge')).toHaveAttribute('data-state', 'conflict'))
  })

  it('ignores entries from other resources', async () => {
    await enqueue(baseEntry({ resourceKey: 'routine:7' }))
    const { container } = render(<SyncStatusBadge resourceKey="routine:5" />)
    await flushQueueReads()
    expect(container.firstChild).toBeNull()
  })

  it('renders the error icon when the only entry failed', async () => {
    await enqueue(baseEntry({ status: 'error', errorMessage: 'HTTP 400' }))
    render(<SyncStatusBadge resourceKey="routine:5" />)
    await waitFor(() => expect(screen.getByTestId('sync-status-badge')).toHaveAttribute('data-state', 'error'))
  })
})
