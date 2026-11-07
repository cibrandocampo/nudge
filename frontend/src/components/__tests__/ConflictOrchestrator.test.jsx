import 'fake-indexeddb/auto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueue, list } from '../../offline/queue'
import { __resetSyncWorkerForTests } from '../../offline/sync'
import { flushQueueReads } from '../../test/helpers'
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

// "Keep mine" re-issues the PATCH through the sync worker. Holding that request
// in flight leaves the new entry `syncing` and the queue still: one settled
// state to assert on, and nothing that changes after the test ends.
function holdPatch() {
  server.use(http.patch('http://localhost/api/routines/5/', () => new Promise(() => {})))
}

async function keepMine(user) {
  await user.click(screen.getByRole('button', { name: /Overwrite with my version/i }))
  await waitFor(async () => expect((await list()).map((e) => e.status)).toEqual(['syncing']))
  await flushQueueReads()
  const [next] = await list()
  return next
}

function renderWithQC(qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <ConflictOrchestrator />
    </QueryClientProvider>,
  )
}

// The global setup empties the queue before each test and clears storage after
// it (src/test/setup.js). Clearing here after a test would change the queue
// under a still-mounted orchestrator.
beforeEach(() => {
  __resetSyncWorkerForTests()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(() => {
  __resetSyncWorkerForTests()
})

describe('ConflictOrchestrator', () => {
  it('renders nothing when no entries are in conflict', async () => {
    const { container } = renderWithQC()
    await flushQueueReads()
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

  it('"Keep mine" replays the change and empties the queue when the server accepts it', async () => {
    let patches = 0
    server.use(
      http.patch('http://localhost/api/routines/5/', () => {
        patches += 1
        return HttpResponse.json({ id: 5, name: 'Coco' })
      }),
    )
    await enqueue(conflict())
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    await user.click(screen.getByRole('button', { name: /Overwrite with my version/i }))
    await waitFor(async () => expect(await list()).toEqual([]))
    await flushQueueReads()
    expect(patches).toBe(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"Keep mine" falls back to settings_updated_at when updated_at is missing', async () => {
    holdPatch()
    await enqueue(conflict({ conflictCurrent: { id: 5, settings_updated_at: '2026-04-17T10:00:00Z' } }))
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    const next = await keepMine(user)
    expect(next.ifUnmodifiedSince).toBe('2026-04-17T10:00:00Z')
  })

  it('"Keep mine" leaves ifUnmodifiedSince=null when no timestamp is on conflictCurrent', async () => {
    holdPatch()
    // resourceKey also absent to cover the `?? null` fallback.
    await enqueue(conflict({ conflictCurrent: { id: 5, name: 'X' }, resourceKey: undefined }))
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    const next = await keepMine(user)
    expect(next.ifUnmodifiedSince).toBeNull()
    expect(next.resourceKey).toBeNull()
  })

  it('"Keep mine" re-enqueues with a new id and the server\'s updated_at', async () => {
    holdPatch()
    await enqueue(conflict())
    const user = userEvent.setup()
    renderWithQC()
    await waitFor(() => screen.getByRole('dialog'))
    const next = await keepMine(user)
    // The old k-1 is gone; the only entry is its replacement, now syncing.
    expect(next.id).not.toBe('k-1')
    expect(next.ifUnmodifiedSince).toBe('2026-04-17T09:15:00Z')
    expect(next.method).toBe('PATCH')
    expect(next.endpoint).toBe('/routines/5/')
    expect(next.body).toEqual({ name: 'Coco' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
