import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clear,
  discard,
  enqueue,
  list,
  markConflict,
  markError,
  markPending,
  markRetryPending,
  markSyncing,
  remove,
  subscribe,
} from '../queue'

function baseEntry(overrides = {}) {
  return {
    id: 'abc',
    method: 'POST',
    endpoint: '/routines/1/log/',
    body: { notes: 'hi' },
    resourceKey: 'routine:1',
    ifUnmodifiedSince: null,
    createdAt: '2026-04-17T08:00:00.000Z',
    status: 'pending',
    ...overrides,
  }
}

describe('offline queue', () => {
  beforeEach(async () => {
    await clear()
  })

  afterEach(async () => {
    await clear()
  })

  it('enqueue stores the entry and list returns it', async () => {
    await enqueue(baseEntry())
    const all = await list()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe('abc')
    expect(all[0].body).toEqual({ notes: 'hi' })
  })

  it('rejects entries without an id', async () => {
    await expect(enqueue({ method: 'POST' })).rejects.toThrow(/Idempotency-Key/)
  })

  it('list sorts by createdAt ascending (FIFO)', async () => {
    await enqueue(baseEntry({ id: 'b', createdAt: '2026-04-17T08:00:02.000Z' }))
    await enqueue(baseEntry({ id: 'a', createdAt: '2026-04-17T08:00:00.000Z' }))
    await enqueue(baseEntry({ id: 'c', createdAt: '2026-04-17T08:00:01.000Z' }))
    const all = await list()
    expect(all.map((e) => e.id)).toEqual(['a', 'c', 'b'])
  })

  it('markSyncing/markError/markConflict/markPending update the status field', async () => {
    await enqueue(baseEntry())
    expect((await list())[0].status).toBe('pending')

    await markSyncing('abc')
    expect((await list())[0].status).toBe('syncing')

    await markError('abc', 'HTTP 500')
    const errored = (await list())[0]
    expect(errored.status).toBe('error')
    expect(errored.errorMessage).toBe('HTTP 500')

    await markConflict('abc', { id: 1, name: 'server' })
    const conflicted = (await list())[0]
    expect(conflicted.status).toBe('conflict')
    expect(conflicted.conflictCurrent).toEqual({ id: 1, name: 'server' })

    await markPending('abc')
    const retried = (await list())[0]
    expect(retried.status).toBe('pending')
    expect(retried.errorMessage).toBeUndefined()
  })

  it('mark functions return null for unknown ids without throwing', async () => {
    const result = await markSyncing('does-not-exist')
    expect(result).toBeNull()
  })

  it('remove deletes the entry', async () => {
    await enqueue(baseEntry())
    await remove('abc')
    expect(await list()).toHaveLength(0)
  })

  it('clear empties the store', async () => {
    await enqueue(baseEntry({ id: 'a' }))
    await enqueue(baseEntry({ id: 'b' }))
    await clear()
    expect(await list()).toHaveLength(0)
  })

  it('subscribe fires on every mutation and returns an unsubscribe fn', async () => {
    const listener = vi.fn()
    const unsub = subscribe(listener)

    await enqueue(baseEntry())
    await markSyncing('abc')
    await remove('abc')
    expect(listener).toHaveBeenCalledTimes(3)

    unsub()
    await enqueue(baseEntry({ id: 'b' }))
    expect(listener).toHaveBeenCalledTimes(3)
  })

  // ── T064: retry counters + scheduled retries ────────────────────────────

  it('enqueue defaults retryCount to 0 and nextAttemptAt to null', async () => {
    await enqueue(baseEntry())
    const [entry] = await list()
    expect(entry.retryCount).toBe(0)
    expect(entry.nextAttemptAt).toBeNull()
  })

  it('enqueue preserves caller-provided retryCount / nextAttemptAt', async () => {
    await enqueue(baseEntry({ retryCount: 2, nextAttemptAt: '2030-01-01T00:00:00.000Z' }))
    const [entry] = await list()
    expect(entry.retryCount).toBe(2)
    expect(entry.nextAttemptAt).toBe('2030-01-01T00:00:00.000Z')
  })

  it('markRetryPending increments retryCount and sets a future nextAttemptAt', async () => {
    const before = Date.now()
    await enqueue(baseEntry())
    const updated = await markRetryPending('abc', 2_000)
    expect(updated.status).toBe('pending')
    expect(updated.retryCount).toBe(1)
    const scheduled = Date.parse(updated.nextAttemptAt)
    expect(scheduled).toBeGreaterThanOrEqual(before + 2_000)
    // Within a generous tolerance (CI can be slow).
    expect(scheduled).toBeLessThan(before + 10_000)
  })

  it('markRetryPending bumps the counter on every call', async () => {
    await enqueue(baseEntry())
    await markRetryPending('abc', 2_000)
    const second = await markRetryPending('abc', 10_000)
    expect(second.retryCount).toBe(2)
  })

  it('markRetryPending returns null for unknown ids without throwing', async () => {
    const result = await markRetryPending('does-not-exist', 2_000)
    expect(result).toBeNull()
  })

  it('markPending preserves retryCount and nextAttemptAt (bootstrap-safe)', async () => {
    await enqueue(baseEntry({ retryCount: 2, nextAttemptAt: '2030-01-01T00:00:00.000Z' }))
    await markSyncing('abc')
    const restored = await markPending('abc')
    expect(restored.retryCount).toBe(2)
    expect(restored.nextAttemptAt).toBe('2030-01-01T00:00:00.000Z')
  })

  // discard() falls back to invalidating queries by resourceKey when no
  // rollbackType was registered. Each prefix maps to a distinct queryKey.

  it('discard with entry: resourceKey invalidates the entries query', async () => {
    await enqueue(baseEntry({ id: 'd1', resourceKey: 'entry:42' }))
    const qc = { invalidateQueries: vi.fn() }
    await discard('d1', qc)
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['entries'] })
    expect(await list()).toHaveLength(0)
  })

  it('discard with consumption: resourceKey invalidates stock-consumptions', async () => {
    await enqueue(baseEntry({ id: 'd2', resourceKey: 'consumption:9' }))
    const qc = { invalidateQueries: vi.fn() }
    await discard('d2', qc)
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['stock-consumptions'] })
  })

  it('discard with an unknown resourceKey prefix removes the entry without invalidating', async () => {
    await enqueue(baseEntry({ id: 'd3', resourceKey: 'unknown:1' }))
    const qc = { invalidateQueries: vi.fn() }
    await discard('d3', qc)
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
    expect(await list()).toHaveLength(0)
  })

  it('discard is a no-op when the id is not in the queue', async () => {
    const qc = { invalidateQueries: vi.fn() }
    await discard('does-not-exist', qc)
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
  })
})
