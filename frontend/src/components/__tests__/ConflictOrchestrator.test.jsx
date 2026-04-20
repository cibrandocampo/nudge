import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clear, enqueue, list } from '../../offline/queue'
import { __resetSyncWorkerForTests } from '../../offline/sync'
import { mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import ConflictOrchestrator from '../ConflictOrchestrator'

function conflict(overrides = {}) {
  return {
    id: 'k-1',
    method: 'PATCH',
    endpoint: '/routines/5/',
    body: { name: 'Coco' },
    resourceKey: 'routine:5',
    ifUnmodifiedSince: '2026-04-17T08:00:00Z',
    createdAt: '2026-04-17T08:00:00Z',
    status: 'conflict',
    conflictCurrent: { id: 5, name: 'Max', updated_at: '2026-04-17T09:15:00Z' },
    ...overrides,
  }
}

function renderWithQC(qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <ConflictOrchestrator />
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  await clear()
  __resetSyncWorkerForTests()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  await clear()
  __resetSyncWorkerForTests()
  localStorage.clear()
})

describe('ConflictOrchestrator', () => {
  it('renders nothing when no entries are in conflict', () => {
    const { container } = renderWithQC()
    expect(container.firstChild).toBeNull()
  })

  it('opens the modal for the first conflict in the queue', async () => {
    await enqueue(conflict())
    renderWithQC()
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.getByText('This item was edited elsewhere')).toBeInTheDocument()
  })

  it('close (×) dismisses the modal without touching the queue', async () => {
    await enqueue(conflict())
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    await user.click(screen.getByRole('button', { name: /close/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await list()).toHaveLength(1)
  })

  it('"Use server" removes the entry and invalidates the cache', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    await enqueue(conflict())
    const user = userEvent.setup()
    renderWithQC(qc)
    await waitFor(() => screen.getByRole('dialog'))
    await user.click(screen.getByRole('button', { name: /Discard my changes/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await list()).toHaveLength(0)
    expect(spy).toHaveBeenCalled()
  })

  it('"Keep mine" falls back to settings_updated_at when updated_at is missing', async () => {
    server.use(mockNetworkError('patch', '/routines/5/'))
    await enqueue(conflict({ conflictCurrent: { id: 5, settings_updated_at: '2026-04-17T10:00:00Z' } }))
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    await user.click(screen.getByRole('button', { name: /Overwrite with my version/i }))
    await waitFor(async () => {
      const rows = await list()
      expect(rows.some((e) => e.id === 'k-1')).toBe(false)
    })
    const [next] = await list()
    expect(next.ifUnmodifiedSince).toBe('2026-04-17T10:00:00Z')
  })

  it('"Keep mine" leaves ifUnmodifiedSince=null when no timestamp is on conflictCurrent', async () => {
    server.use(mockNetworkError('patch', '/routines/5/'))
    // resourceKey also absent to cover the `?? null` on line 50.
    await enqueue(conflict({ conflictCurrent: { id: 5, name: 'X' }, resourceKey: undefined }))
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    await user.click(screen.getByRole('button', { name: /Overwrite with my version/i }))
    await waitFor(async () => {
      const rows = await list()
      expect(rows.some((e) => e.id === 'k-1')).toBe(false)
    })
    const [next] = await list()
    expect(next.ifUnmodifiedSince).toBeNull()
    expect(next.resourceKey).toBeNull()
  })

  it('"Keep mine" re-enqueues with a new id and the server\'s updated_at', async () => {
    // Simulate still-offline so forceSync leaves the new entry pending
    // instead of immediately replaying and removing it.
    server.use(mockNetworkError('patch', '/routines/5/'))
    await enqueue(conflict())
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    await user.click(screen.getByRole('button', { name: /Overwrite with my version/i }))
    await waitFor(async () => {
      const rows = await list()
      // The old k-1 is gone; a new entry replaces it.
      expect(rows.some((e) => e.id === 'k-1')).toBe(false)
      expect(rows).toHaveLength(1)
    })
    const rows = await list()
    const next = rows[0]
    // After forceSync with simulated offline, the entry is left either
    // pending (still queued) or syncing (mid-drain when we observed it).
    expect(['pending', 'syncing']).toContain(next.status)
    expect(next.ifUnmodifiedSince).toBe('2026-04-17T09:15:00Z')
    expect(next.method).toBe('PATCH')
    expect(next.endpoint).toBe('/routines/5/')
    expect(next.body).toEqual({ name: 'Coco' })
  })
})
