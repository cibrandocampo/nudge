import 'fake-indexeddb/auto'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { mockConflict, mockNetworkError } from '../../test/mocks/handlers'
import { server } from '../../test/mocks/server'
import { clear, enqueue, list, remove } from '../queue'
import {
  MAX_RETRIES,
  RETRY_DELAYS_MS,
  __resetSyncWorkerForTests,
  forceSync,
  initSyncWorker,
  processQueue,
  registerBackgroundSync,
  subscribeSyncEvents,
} from '../sync'

const BASE = 'http://localhost/api'

function fakeQueryClient() {
  return {
    invalidateQueries: vi.fn(async () => {}),
  }
}

function pendingEntry(overrides = {}) {
  return {
    id: 'k-1',
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

beforeEach(async () => {
  __resetSyncWorkerForTests()
  await clear()
  localStorage.setItem('access_token', 'test-token')
})

afterEach(async () => {
  __resetSyncWorkerForTests()
  await clear()
  localStorage.clear()
})

describe('offline sync worker', () => {
  it('drains a pending entry, removes it, and invalidates queries', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    let keyReceived = null
    server.use(
      http.post(`${BASE}/routines/1/log/`, ({ request }) => {
        keyReceived = request.headers.get('Idempotency-Key')
        return HttpResponse.json({ id: 10 }, { status: 201 })
      }),
    )

    await enqueue(pendingEntry())
    await processQueue()

    expect(await list()).toHaveLength(0)
    expect(keyReceived).toBe('k-1')
    expect(qc.invalidateQueries).toHaveBeenCalled()
  })

  it('processes entries in FIFO order', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    const order = []
    server.use(
      http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
        order.push(request.headers.get('Idempotency-Key'))
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    await enqueue(pendingEntry({ id: 'b', createdAt: '2026-04-17T08:00:02.000Z' }))
    await enqueue(pendingEntry({ id: 'a', createdAt: '2026-04-17T08:00:00.000Z' }))
    await enqueue(pendingEntry({ id: 'c', createdAt: '2026-04-17T08:00:01.000Z' }))
    await processQueue()

    expect(order).toEqual(['a', 'c', 'b'])
    expect(await list()).toHaveLength(0)
  })

  it('marks conflict and halts when the server returns 412', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    server.use(mockConflict('patch', '/routines/1/', { id: 1, name: 'server' }))

    await enqueue(
      pendingEntry({
        method: 'PATCH',
        endpoint: '/routines/1/',
        body: { name: 'client' },
      }),
    )
    await enqueue(
      pendingEntry({
        id: 'k-2',
        method: 'PATCH',
        endpoint: '/routines/1/',
        body: { name: 'later' },
        createdAt: '2026-04-17T08:00:05.000Z',
      }),
    )

    await processQueue()

    const all = await list()
    const first = all.find((e) => e.id === 'k-1')
    const second = all.find((e) => e.id === 'k-2')
    expect(first.status).toBe('conflict')
    expect(first.conflictCurrent).toEqual({ id: 1, name: 'server' })
    // Second entry not processed — conflict halts the drain
    expect(second.status).toBe('pending')
  })

  it('leaves entry pending and halts when network is offline', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    server.use(mockNetworkError('post', '/routines/1/log/'))

    await enqueue(pendingEntry())
    await processQueue()

    const [entry] = await list()
    expect(entry.status).toBe('pending')
    expect(qc.invalidateQueries).not.toHaveBeenCalled()
  })

  it('marks entry as error and moves on for non-412 4xx responses', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    server.use(
      http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 400 })),
      http.post(`${BASE}/routines/2/log/`, () => HttpResponse.json({}, { status: 201 })),
    )

    await enqueue(pendingEntry({ id: 'bad' }))
    await enqueue(
      pendingEntry({
        id: 'ok',
        endpoint: '/routines/2/log/',
        createdAt: '2026-04-17T08:00:10.000Z',
      }),
    )
    await processQueue()

    const all = await list()
    const bad = all.find((e) => e.id === 'bad')
    expect(bad).toBeDefined()
    expect(bad.status).toBe('error')
    expect(bad.errorMessage).toBe('HTTP 400')
    // The successful second entry got removed
    expect(all.find((e) => e.id === 'ok')).toBeUndefined()
  })

  it('re-running processQueue concurrently does not fire duplicate network calls', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    let hits = 0
    server.use(
      http.post(`${BASE}/routines/1/log/`, async () => {
        hits++
        await new Promise((r) => setTimeout(r, 5))
        return HttpResponse.json({}, { status: 201 })
      }),
    )

    await enqueue(pendingEntry())
    await Promise.all([processQueue(), processQueue()])

    // At most two hits (once for the drain, once for the rerun that the
    // second call schedules after the first finishes). We care that it is
    // bounded — not 2×N calls per entry.
    expect(hits).toBeLessThanOrEqual(2)
    expect(await list()).toHaveLength(0)
  })

  it('forceSync is an alias for processQueue', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
    await enqueue(pendingEntry())
    await forceSync()

    expect(await list()).toHaveLength(0)
  })

  it("'online' window event triggers a drain", async () => {
    const qc = fakeQueryClient()
    // initSyncWorker also drains immediately; register AFTER enqueue so the
    // drain we observe is the one fired by the online event.
    await enqueue(pendingEntry())

    server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
    initSyncWorker(qc)
    // Let the immediate drain finish
    await new Promise((r) => setTimeout(r, 10))

    // Now enqueue another and fire 'online'
    await enqueue(pendingEntry({ id: 'k-2', createdAt: '2026-04-17T08:01:00.000Z' }))
    window.dispatchEvent(new Event('online'))
    await new Promise((r) => setTimeout(r, 20))

    expect(await list()).toHaveLength(0)
  })

  it('processes without a query client (invalidation step is a no-op)', async () => {
    initSyncWorker(null)
    server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
    await enqueue(pendingEntry())
    await processQueue()
    expect(await list()).toHaveLength(0)
  })

  it('does not register Background Sync when the queue becomes empty', async () => {
    const registerSpy = vi.fn().mockResolvedValue(undefined)
    const swStub = {
      ready: Promise.resolve({ sync: { register: registerSpy } }),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const originalSw = navigator.serviceWorker
    const originalSync = window.SyncManager
    navigator.serviceWorker = swStub
    window.SyncManager = function SyncManager() {}

    try {
      initSyncWorker(fakeQueryClient())
      // An enqueue then a remove — the remove event should NOT re-register.
      await enqueue(pendingEntry())
      await new Promise((r) => setTimeout(r, 5))
      registerSpy.mockClear()
      const { remove } = await import('../queue')
      await remove('k-1')
      await new Promise((r) => setTimeout(r, 5))
      expect(registerSpy).not.toHaveBeenCalled()
    } finally {
      navigator.serviceWorker = originalSw
      if (originalSync === undefined) delete window.SyncManager
      else window.SyncManager = originalSync
    }
  })

  it('__resetSyncWorkerForTests is safe to call before initSyncWorker', () => {
    expect(() => __resetSyncWorkerForTests()).not.toThrow()
  })

  it('initSyncWorker is idempotent (second call is a no-op)', () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)
    expect(() => initSyncWorker(qc)).not.toThrow()
  })

  it('processes a queued GET request via api.get', async () => {
    initSyncWorker(fakeQueryClient())
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json({ id: 1 })))
    await enqueue(
      pendingEntry({
        method: 'GET',
        endpoint: '/routines/1/',
        body: null,
      }),
    )
    await processQueue()
    expect(await list()).toHaveLength(0)
  })

  it('handles thrown non-Error values (no .message) gracefully', async () => {
    initSyncWorker(fakeQueryClient())
    const spy = vi.spyOn(api, 'post').mockImplementationOnce(() => {
      // Throw a bare string — no .message property to read
      throw 'string-error'
    })
    try {
      await enqueue(pendingEntry())
      await processQueue()
      const [entry] = await list()
      expect(entry.status).toBe('error')
      expect(entry.errorMessage).toBe('string-error')
    } finally {
      spy.mockRestore()
    }
  })

  it('marks entry as error when the api client throws an unexpected error', async () => {
    const qc = fakeQueryClient()
    initSyncWorker(qc)

    const spy = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('boom'))
    try {
      await enqueue(pendingEntry())
      await processQueue()
      const [entry] = await list()
      expect(entry.status).toBe('error')
      expect(entry.errorMessage).toBe('boom')
    } finally {
      spy.mockRestore()
    }
  })

  // ── Background Sync ──────────────────────────────────────────────────────
  describe('registerBackgroundSync', () => {
    it('returns false when navigator.serviceWorker is absent', async () => {
      const original = navigator.serviceWorker
      navigator.serviceWorker = undefined
      try {
        expect(await registerBackgroundSync()).toBe(false)
      } finally {
        navigator.serviceWorker = original
      }
    })

    it('returns false when SyncManager is not available', async () => {
      const hadSync = 'SyncManager' in window
      const saved = hadSync ? window.SyncManager : undefined
      if (hadSync) delete window.SyncManager
      try {
        expect(await registerBackgroundSync()).toBe(false)
      } finally {
        if (hadSync) window.SyncManager = saved
      }
    })

    it('registers the tag when the SyncManager and SW are present', async () => {
      const registerSpy = vi.fn().mockResolvedValue(undefined)
      const swStub = {
        ready: Promise.resolve({ sync: { register: registerSpy } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      const originalSw = navigator.serviceWorker
      const originalSync = window.SyncManager
      navigator.serviceWorker = swStub
      window.SyncManager = function SyncManager() {}

      try {
        expect(await registerBackgroundSync()).toBe(true)
        expect(registerSpy).toHaveBeenCalledWith('nudge-offline-queue')
      } finally {
        navigator.serviceWorker = originalSw
        if (originalSync === undefined) delete window.SyncManager
        else window.SyncManager = originalSync
      }
    })

    it('returns false if register throws (no uncaught rejection)', async () => {
      const swStub = {
        ready: Promise.resolve({ sync: { register: vi.fn().mockRejectedValue(new Error('nope')) } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      const originalSw = navigator.serviceWorker
      const originalSync = window.SyncManager
      navigator.serviceWorker = swStub
      window.SyncManager = function SyncManager() {}

      try {
        expect(await registerBackgroundSync()).toBe(false)
      } finally {
        navigator.serviceWorker = originalSw
        if (originalSync === undefined) delete window.SyncManager
        else window.SyncManager = originalSync
      }
    })

    it('initSyncWorker triggers Background Sync registration on enqueue', async () => {
      const registerSpy = vi.fn().mockResolvedValue(undefined)
      const swStub = {
        ready: Promise.resolve({ sync: { register: registerSpy } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      const originalSw = navigator.serviceWorker
      const originalSync = window.SyncManager
      navigator.serviceWorker = swStub
      window.SyncManager = function SyncManager() {}

      try {
        initSyncWorker(fakeQueryClient())
        await enqueue(pendingEntry())
        // Queue subscribers are called synchronously; the async registration
        // races after. Give it a tick to settle.
        await new Promise((r) => setTimeout(r, 10))
        expect(registerSpy).toHaveBeenCalledWith('nudge-offline-queue')
      } finally {
        navigator.serviceWorker = originalSw
        if (originalSync === undefined) delete window.SyncManager
        else window.SyncManager = originalSync
      }
    })
  })

  it('registers a service-worker message listener when available', async () => {
    // Stub navigator.serviceWorker.addEventListener so the SW wiring branch
    // runs; capture handlers so we can fire PROCESS_QUEUE synthetically.
    const listeners = {}
    const swStub = {
      addEventListener: (type, fn) => {
        listeners[type] = fn
      },
      removeEventListener: (type, fn) => {
        if (listeners[type] === fn) delete listeners[type]
      },
    }
    const original = navigator.serviceWorker
    // setup.js defined serviceWorker with `writable: true`, so direct
    // assignment swaps it cleanly without redefining the descriptor.
    navigator.serviceWorker = swStub

    try {
      initSyncWorker(fakeQueryClient())
      expect(typeof listeners.message).toBe('function')

      server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
      await enqueue(pendingEntry())

      // Simulate the service worker posting PROCESS_QUEUE
      listeners.message({ data: { type: 'PROCESS_QUEUE' } })
      await new Promise((r) => setTimeout(r, 20))
      expect(await list()).toHaveLength(0)

      // Unrelated message is ignored
      listeners.message({ data: { type: 'OTHER' } })

      __resetSyncWorkerForTests()
      expect(listeners.message).toBeUndefined()
    } finally {
      navigator.serviceWorker = original
    }
  })

  // ── T064: backoff retries + bootstrap cleanup ─────────────────────────────

  describe('retry backoff', () => {
    it('reschedules with the first backoff delay on 5xx (retryCount 0 → 1)', async () => {
      initSyncWorker(fakeQueryClient())
      server.use(http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 503 })))
      await enqueue(pendingEntry())
      await processQueue()

      const [entry] = await list()
      expect(entry.status).toBe('pending')
      expect(entry.retryCount).toBe(1)
      const scheduled = Date.parse(entry.nextAttemptAt)
      // Scheduled roughly `RETRY_DELAYS_MS[0]` in the future (±1s window).
      expect(scheduled - Date.now()).toBeGreaterThanOrEqual(RETRY_DELAYS_MS[0] - 1_000)
      expect(scheduled - Date.now()).toBeLessThanOrEqual(RETRY_DELAYS_MS[0] + 1_000)
    })

    it('retries 408, 429 and 5xx but NOT 400/403/404/409', async () => {
      initSyncWorker(fakeQueryClient())
      const notRetryable = [400, 403, 404, 409]
      for (const status of notRetryable) {
        await clear()
        server.use(http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status })))
        await enqueue(pendingEntry())
        await processQueue()
        const [entry] = await list()
        expect(entry.status).toBe('error')
        expect(entry.retryCount).toBe(0)
      }

      const retryable = [408, 429, 500, 502, 503, 504]
      for (const status of retryable) {
        await clear()
        server.use(http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status })))
        await enqueue(pendingEntry())
        await processQueue()
        const [entry] = await list()
        expect(entry.status).toBe('pending')
        expect(entry.retryCount).toBe(1)
      }
    })

    it('transitions to error after MAX_RETRIES consecutive failures', async () => {
      initSyncWorker(fakeQueryClient())
      server.use(http.post(`${BASE}/routines/1/log/`, () => new HttpResponse(null, { status: 503 })))

      // Seed the entry already at MAX_RETRIES so the next failure tips it
      // over the edge without waiting for real backoff timers.
      await enqueue(pendingEntry({ retryCount: MAX_RETRIES, nextAttemptAt: null }))
      await processQueue()

      const [entry] = await list()
      expect(entry.status).toBe('error')
      expect(entry.errorMessage).toMatch(/HTTP 503 after \d+ retries/)
    })

    it('re-runs automatically after the scheduled backoff fires', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        initSyncWorker(fakeQueryClient())
        let attempts = 0
        server.use(
          http.post(`${BASE}/routines/1/log/`, () => {
            attempts++
            // Fail the first two times, succeed the third.
            if (attempts < 3) return new HttpResponse(null, { status: 503 })
            return HttpResponse.json({}, { status: 201 })
          }),
        )

        await enqueue(pendingEntry())
        await processQueue()
        expect(attempts).toBe(1)

        // First backoff window: RETRY_DELAYS_MS[0] (2s).
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] + 100)
        expect(attempts).toBe(2)

        // Second backoff window: RETRY_DELAYS_MS[1] (10s).
        await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[1] + 100)
        expect(attempts).toBe(3)
        expect(await list()).toHaveLength(0)
      } finally {
        vi.useRealTimers()
      }
    })

    it('skips scheduled entries until their nextAttemptAt arrives', async () => {
      initSyncWorker(fakeQueryClient())
      // Entry A ready now; entry B scheduled for the future. Ready one
      // goes out, future one stays.
      server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
      await enqueue(pendingEntry({ id: 'ready' }))
      await enqueue(
        pendingEntry({
          id: 'scheduled',
          retryCount: 1,
          nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
          createdAt: '2026-04-17T08:01:00.000Z',
        }),
      )
      await processQueue()

      const all = await list()
      expect(all).toHaveLength(1)
      expect(all[0].id).toBe('scheduled')
    })
  })

  // ── T065: polish ─────────────────────────────────────────────────────────

  describe('focal invalidation', () => {
    it('invalidates only the query keys derived from resourceKey', async () => {
      const qc = fakeQueryClient()
      initSyncWorker(qc)
      server.use(http.post(`${BASE}/routines/7/log/`, () => HttpResponse.json({}, { status: 201 })))
      await enqueue(
        pendingEntry({
          endpoint: '/routines/7/log/',
          resourceKey: 'routine:7',
        }),
      )
      await processQueue()

      const calls = qc.invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)
      // Focal keys for a routine, not a blanket invalidate.
      expect(calls).toEqual(
        expect.arrayContaining([['dashboard'], ['routines'], ['routine', 7], ['routine-entries', 7], ['entries']]),
      )
      // The blanket "no queryKey" call is the old behaviour we removed.
      expect(qc.invalidateQueries).not.toHaveBeenCalledWith()
    })

    it('falls back to dashboard when resourceKey is missing', async () => {
      const qc = fakeQueryClient()
      initSyncWorker(qc)
      server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
      await enqueue(pendingEntry({ resourceKey: null }))
      await processQueue()

      const calls = qc.invalidateQueries.mock.calls.map(([arg]) => arg.queryKey)
      expect(calls).toEqual([['dashboard']])
    })
  })

  describe('abort controller on remove', () => {
    it('cancels the in-flight fetch when the entry is removed mid-flight', async () => {
      initSyncWorker(fakeQueryClient())
      let handlerSignal = null
      server.use(
        http.post(`${BASE}/routines/1/log/`, async ({ request }) => {
          handlerSignal = request.signal
          // Hang until aborted — MSW resolves the fetch with AbortError.
          await new Promise((_, reject) => {
            request.signal.addEventListener('abort', () => reject(new Error('aborted')))
          })
          return HttpResponse.json({}, { status: 201 })
        }),
      )

      await enqueue(pendingEntry())
      const runPromise = processQueue()
      // Wait a tick so runEntry has time to register the controller.
      await new Promise((r) => setTimeout(r, 10))
      await remove('k-1')
      await runPromise

      expect(handlerSignal?.aborted).toBe(true)
      expect(await list()).toHaveLength(0)
    })
  })

  describe('sync events', () => {
    it('emits drain-complete with successCount + errorCount after a drain', async () => {
      initSyncWorker(fakeQueryClient())
      const events = []
      const unsubscribe = subscribeSyncEvents((ev) => events.push(ev.detail))
      server.use(
        http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })),
        http.post(`${BASE}/routines/2/log/`, () => new HttpResponse(null, { status: 400 })),
      )
      await enqueue(pendingEntry({ id: 'ok' }))
      await enqueue(
        pendingEntry({
          id: 'err',
          endpoint: '/routines/2/log/',
          createdAt: '2026-04-17T08:01:00.000Z',
        }),
      )
      await processQueue()
      unsubscribe()

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'drain-complete', successCount: 1, errorCount: 1 })
    })

    it('does not emit when the drain processed no entries', async () => {
      initSyncWorker(fakeQueryClient())
      const events = []
      const unsubscribe = subscribeSyncEvents((ev) => events.push(ev.detail))
      await processQueue()
      unsubscribe()
      expect(events).toHaveLength(0)
    })
  })

  describe('Background Sync debounce', () => {
    it('registers only once per 0 → ≥1 pending transition, not on every emit', async () => {
      const registerSpy = vi.fn().mockResolvedValue(undefined)
      const swStub = {
        ready: Promise.resolve({ sync: { register: registerSpy } }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }
      const originalSw = navigator.serviceWorker
      const originalSync = window.SyncManager
      navigator.serviceWorker = swStub
      window.SyncManager = function SyncManager() {}

      try {
        initSyncWorker(fakeQueryClient())
        await enqueue(pendingEntry({ id: 'a' }))
        await enqueue(pendingEntry({ id: 'b', createdAt: '2026-04-17T08:01:00.000Z' }))
        // Give the queue listeners time to run.
        await new Promise((r) => setTimeout(r, 20))
        // One transition 0 → ≥1; the second enqueue keeps pending ≥1.
        expect(registerSpy).toHaveBeenCalledTimes(1)

        // Drain back to empty via `remove` (no network roundtrip).
        await remove('a')
        await remove('b')
        await new Promise((r) => setTimeout(r, 20))

        registerSpy.mockClear()
        await enqueue(pendingEntry({ id: 'c', createdAt: '2026-04-17T08:02:00.000Z' }))
        await new Promise((r) => setTimeout(r, 20))
        // New 0 → ≥1 transition: registers once more.
        expect(registerSpy).toHaveBeenCalledTimes(1)
      } finally {
        navigator.serviceWorker = originalSw
        if (originalSync === undefined) delete window.SyncManager
        else window.SyncManager = originalSync
      }
    })
  })

  describe('bootstrap cleanup', () => {
    it('converts orphan syncing entries back to pending during forceSync', async () => {
      // Seed a pre-existing entry stuck in `syncing` status (simulating a
      // previous tab that went away mid-flight).
      await enqueue(pendingEntry({ status: 'syncing', retryCount: 1 }))
      server.use(http.post(`${BASE}/routines/1/log/`, () => HttpResponse.json({}, { status: 201 })))
      initSyncWorker(fakeQueryClient())
      await forceSync()

      expect(await list()).toHaveLength(0)
    })

    it('preserves retryCount when converting syncing → pending', async () => {
      // Block any network call so the drain pauses immediately after
      // bootstrap cleanup; we only want to observe the cleanup step.
      server.use(mockNetworkError('post', '/routines/1/log/'))
      await enqueue(pendingEntry({ status: 'syncing', retryCount: 2, nextAttemptAt: null }))
      initSyncWorker(fakeQueryClient())
      await forceSync()

      const [entry] = await list()
      expect(entry.status).toBe('pending')
      expect(entry.retryCount).toBe(2)
    })
  })
})
