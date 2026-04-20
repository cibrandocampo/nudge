import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'

// Storage key used to persist the TanStack Query cache in IndexedDB. A
// single key holds the whole serialized client snapshot.
const IDB_KEY = 'nudge-query-cache'

// `gcTime: Infinity` keeps data in memory so the persister can write the
// full snapshot on every change; eviction happens when the persister's
// `maxAge` expires (configured by the provider). Instant paint offline
// comes from this + the persister, NOT from `staleTime` — so we use the
// TanStack default of 0 (fetch on mount/focus/reconnect). For a ~10-user
// app the extra refetches are negligible and guarantee fresh data.
//
// Retry policy: do NOT retry 4xx (client bugs / auth failures). Retry up to
// 2 times on network / 5xx errors so intermittent connectivity doesn't flap
// the UI. Mutations don't retry here — the offline queue (T024) owns retry
// for writes.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: Infinity,
      retry: (failureCount, error) => {
        const status = error?.status ?? error?.response?.status
        if (status >= 400 && status < 500) return false
        return failureCount < 2
      },
    },
    mutations: {
      retry: false,
    },
  },
})

// Async persister backed by IndexedDB via idb-keyval. Survives tab reloads
// and full browser restarts. Works on iOS Safari PWAs subject to the
// 7-day-inactivity eviction rule documented in docs/configuration.md.
export const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => {
      const value = await get(key)
      return value ?? null
    },
    setItem: async (key, value) => {
      await set(key, value)
    },
    removeItem: async (key) => {
      await del(key)
    },
  },
  key: IDB_KEY,
})

export const persistOptions = {
  persister,
  // Throw away persisted cache older than 30 days — stale enough that a
  // full refetch is cheaper than trusting the snapshot.
  maxAge: 30 * 24 * 60 * 60 * 1000,
}
