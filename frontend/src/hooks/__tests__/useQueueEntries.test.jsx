import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { enqueue, markError, markPending } from '../../offline/queue'
import { flushQueueReads } from '../../test/helpers'
import { useQueueEntries } from '../useQueueEntries'

// The global setup empties the queue before each test (src/test/setup.js).

function entry(overrides = {}) {
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

describe('useQueueEntries', () => {
  it('loads the persisted queue after mounting', async () => {
    await enqueue(entry())
    const { result } = renderHook(() => useQueueEntries())
    await waitFor(() => expect(result.current.map((e) => e.id)).toEqual(['k-1']))
  })

  it('follows queue changes made after mounting', async () => {
    await enqueue(entry())
    const { result } = renderHook(() => useQueueEntries())
    await waitFor(() => expect(result.current).toHaveLength(1))

    await act(() => markError('k-1', 'HTTP 400'))
    await flushQueueReads()

    expect(result.current[0]).toMatchObject({ status: 'error', errorMessage: 'HTTP 400' })
  })

  it('keeps the same array when a queue change leaves the entries as they were', async () => {
    // Every routine card holds one of these: a change that does not touch the
    // entries must not hand them a new array (and a re-render).
    await enqueue(entry())
    const { result } = renderHook(() => useQueueEntries())
    await waitFor(() => expect(result.current).toHaveLength(1))
    const before = result.current

    await act(() => markPending('k-1'))
    await flushQueueReads()

    expect(result.current).toBe(before)
  })

  it('drops a read that resolves after unmounting', async () => {
    await enqueue(entry())
    const { result, unmount } = renderHook(() => useQueueEntries())
    unmount()
    // The mount-time read is still in flight; letting it land must not
    // update the unmounted hook.
    await flushQueueReads()
    expect(result.current).toEqual([])
  })
})
