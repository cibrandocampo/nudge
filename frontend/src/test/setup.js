import '@testing-library/jest-dom'
// IndexedDB polyfill for jsdom — the offline queue (T024) is imported
// transitively by components like Header (via PendingBadge). Without this,
// unrelated tests raise "ReferenceError: indexedDB is not defined" as soon
// as they render a subtree that touches the queue.
import 'fake-indexeddb/auto'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../i18n/en.json'
import { clear as clearOfflineQueue } from '../offline/queue'
import { server } from './mocks/server'

// ── i18next (synchronous, no detector) ──────────────────────────────────────
i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

// ── MSW ─────────────────────────────────────────────────────────────────────
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// ── Browser API stubs ───────────────────────────────────────────────────────
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Stub Notification API
if (!('Notification' in window)) {
  window.Notification = { permission: 'default', requestPermission: vi.fn().mockResolvedValue('granted') }
}

// Stub navigator.serviceWorker
Object.defineProperty(navigator, 'serviceWorker', {
  writable: true,
  value: {
    ready: Promise.resolve({
      pushManager: {
        subscribe: vi.fn().mockResolvedValue({
          endpoint: 'https://push.example.com/sub/123',
          getKey: vi.fn().mockReturnValue(new ArrayBuffer(8)),
          unsubscribe: vi.fn().mockResolvedValue(true),
        }),
        getSubscription: vi.fn().mockResolvedValue(null),
      },
    }),
  },
})

// Clean up localStorage between tests
afterEach(() => {
  localStorage.clear()
})

// Drain the offline mutation queue before EACH test — not after. The queue
// lives in IndexedDB (persisted by `fake-indexeddb`) and leaks across
// tests. Since T057 (a successful request can trigger `forceSync`), a
// mutation queued by the previous test would otherwise be replayed by the
// next one's first GET. `beforeEach` guarantees the queue is empty when
// the test body starts, independent of afterEach hook ordering.
beforeEach(async () => {
  await clearOfflineQueue()
})
