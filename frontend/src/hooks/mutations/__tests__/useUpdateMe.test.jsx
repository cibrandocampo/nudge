import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { server } from '../../../test/mocks/server'
import { useUpdateMe } from '../useUpdateMe'

const BASE = 'http://localhost/api'
const T0 = '2026-11-23T10:00:00Z'
const T1 = '2026-11-23T10:00:05Z'
const T2 = '2026-11-23T10:00:10Z'

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function renderUpdateMe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(['me'], { timezone: 'UTC', settings_updated_at: T0 })
  const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result } = renderHook(() => useUpdateMe(), { wrapper })
  return { result, qc }
}

// The first PATCH stays open until `release` resolves; the rest answer at once.
function holdFirstPatch(release) {
  const received = []
  server.use(
    http.patch(`${BASE}/auth/me/`, async ({ request }) => {
      const { timezone } = await request.json()
      received.push({ timezone, since: request.headers.get('If-Unmodified-Since') })
      if (received.length === 1) {
        await release.promise
        return HttpResponse.json({ timezone, settings_updated_at: T1 })
      }
      return HttpResponse.json({ timezone, settings_updated_at: T2 })
    }),
  )
  return received
}

beforeEach(() => {
  localStorage.setItem('access_token', 'test-token')
})

afterEach(() => {
  localStorage.clear()
})

describe('useUpdateMe', () => {
  it('sends the second save only after the first has answered', async () => {
    const release = deferred()
    const received = holdFirstPatch(release)
    const { result, qc } = renderUpdateMe()

    act(() => result.current.mutate({ patch: { timezone: 'Asia/Tokyo' }, updatedAt: T0 }))
    act(() => result.current.mutate({ patch: { timezone: 'Europe/Madrid' }, updatedAt: T0 }))
    await waitFor(() => expect(received).toHaveLength(1))
    expect(received[0].timezone).toBe('Asia/Tokyo')

    await act(async () => release.resolve())
    await waitFor(() => expect(qc.getQueryData(['me']).timezone).toBe('Europe/Madrid'))
    expect(received.map((r) => r.timezone)).toEqual(['Asia/Tokyo', 'Europe/Madrid'])
  })

  it('sends the queued save with the timestamp of the save before it', async () => {
    const release = deferred()
    const received = holdFirstPatch(release)
    const { result, qc } = renderUpdateMe()

    act(() => result.current.mutate({ patch: { timezone: 'Asia/Tokyo' }, updatedAt: T0 }))
    act(() => result.current.mutate({ patch: { timezone: 'Europe/Madrid' }, updatedAt: T0 }))
    await waitFor(() => expect(received).toHaveLength(1))
    await act(async () => release.resolve())
    await waitFor(() => expect(qc.getQueryData(['me']).settings_updated_at).toBe(T2))

    expect(received[1].since).toBe(new Date(T1).toUTCString())
  })

  it('never shows the earlier value while a newer save is running', async () => {
    const release = deferred()
    const received = holdFirstPatch(release)
    const { result, qc } = renderUpdateMe()
    const seen = []
    const unsubscribe = qc.getQueryCache().subscribe(() => seen.push(qc.getQueryData(['me']).timezone))

    act(() => result.current.mutate({ patch: { timezone: 'Asia/Tokyo' }, updatedAt: T0 }))
    act(() => result.current.mutate({ patch: { timezone: 'Europe/Madrid' }, updatedAt: T0 }))
    await waitFor(() => expect(received).toHaveLength(1))
    await act(async () => release.resolve())
    await waitFor(() => expect(qc.getQueryData(['me']).timezone).toBe('Europe/Madrid'))
    unsubscribe()

    expect(seen).not.toContain('Asia/Tokyo')
  })

  it('keeps the saved value in the cache when the save after it fails', async () => {
    const release = deferred()
    let calls = 0
    server.use(
      http.patch(`${BASE}/auth/me/`, async () => {
        calls += 1
        if (calls === 1) {
          await release.promise
          return HttpResponse.json({ timezone: 'Asia/Tokyo', settings_updated_at: T1 })
        }
        return HttpResponse.json({ timezone: ['Invalid'] }, { status: 400 })
      }),
    )
    const { result, qc } = renderUpdateMe()

    act(() => result.current.mutate({ patch: { timezone: 'Asia/Tokyo' }, updatedAt: T0 }))
    act(() => result.current.mutate({ patch: { timezone: 'Nowhere' }, updatedAt: T0 }))
    await waitFor(() => expect(calls).toBe(1))
    await act(async () => release.resolve())

    await waitFor(() => expect(qc.getQueryData(['me']).timezone).toBe('Asia/Tokyo'))
    expect(calls).toBe(2)
  })
})
