import 'fake-indexeddb/auto'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { persistOptions, queryClient } from '../queryClient'

describe('queryClient', () => {
  afterEach(async () => {
    await persistOptions.persister.removeClient()
  })

  it('exports a QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient)
  })

  it('has offline-friendly defaults', () => {
    const defaults = queryClient.getDefaultOptions()
    expect(defaults.queries.gcTime).toBe(Infinity)
    // staleTime is intentionally unset — instant paint offline comes from
    // the persister + `gcTime: Infinity`, not from deferring refetches.
    expect(defaults.queries.staleTime).toBeUndefined()
    expect(defaults.mutations.retry).toBe(false)
  })

  it('skips retry for 4xx', () => {
    const retry = queryClient.getDefaultOptions().queries.retry
    expect(retry(0, { status: 401 })).toBe(false)
    expect(retry(0, { status: 404 })).toBe(false)
  })

  it('retries network / 5xx errors up to 2 times', () => {
    const retry = queryClient.getDefaultOptions().queries.retry
    expect(retry(0, { status: 500 })).toBe(true)
    expect(retry(1, { status: 503 })).toBe(true)
    expect(retry(2, { status: 503 })).toBe(false)
    // Network error (no status)
    expect(retry(0, new TypeError('fetch failed'))).toBe(true)
  })

  it('reads status from response fallback when error.status is missing', () => {
    // Axios-style errors put the status on `error.response.status`
    const retry = queryClient.getDefaultOptions().queries.retry
    expect(retry(0, { response: { status: 404 } })).toBe(false)
    expect(retry(0, { response: { status: 500 } })).toBe(true)
  })

  it('persists a client snapshot to IndexedDB and restores it', async () => {
    const snapshot = { clientState: { queries: [], mutations: [] }, timestamp: Date.now() }
    await persistOptions.persister.persistClient(snapshot)
    const restored = await persistOptions.persister.restoreClient()
    expect(restored).toEqual(snapshot)
  })

  it('removes the snapshot when removeClient is called', async () => {
    const snapshot = { clientState: { queries: [], mutations: [] }, timestamp: Date.now() }
    await persistOptions.persister.persistClient(snapshot)
    await persistOptions.persister.removeClient()
    const restored = await persistOptions.persister.restoreClient()
    expect(restored).toBeUndefined()
  })

  it('configures a 30-day max age for the persisted snapshot', () => {
    expect(persistOptions.maxAge).toBe(30 * 24 * 60 * 60 * 1000)
  })
})
