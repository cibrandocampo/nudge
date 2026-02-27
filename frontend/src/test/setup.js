import '@testing-library/jest-dom'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../i18n/en.json'
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
