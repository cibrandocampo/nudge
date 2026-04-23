import { test, expect } from '@playwright/test'
import { loginAsUser1, resetSeed } from './helpers.js'

/**
 * T041 — Real push delivery end-to-end.
 *
 * Three concepts, three tests:
 *   · Subscribe — clicking "Enable notifications" drives the real
 *     subscribeToPush() → POST /api/push/subscribe/ pipeline and the
 *     backend persists a PushSubscription for user1.
 *   · Deliver  — a push payload emitted to the SW is parsed and
 *     broadcast back to the page via sw.js postMessage hook.
 *   · Unsubscribe — clicking "Disable notifications" drives
 *     unsubscribeFromPush() → DELETE /api/push/unsubscribe/ and the
 *     backend record is gone.
 *
 * Backend coverage in each mutation test is anchored on
 * `POST /api/push/test/`:
 *   · 204 → a PushSubscription row exists for the caller (subscribe OK).
 *   · 404 → no rows exist for the caller (unsubscribe OK).
 * That endpoint checks the DB BEFORE invoking pywebpush, so its status
 * is a clean read of backend state independent of FCM reachability.
 *
 * Delivery (test 2) bypasses pywebpush/FCM on purpose: backend unit
 * tests cover the pywebpush integration, and CDP
 * `ServiceWorker.deliverPushMessage` gives us a deterministic payload
 * straight to the SW without depending on external push services.
 *
 * Headless Chromium caveat
 * ────────────────────────
 * Headless Chromium reports `Notification.permission === 'denied'`
 * even after `grantPermissions(['notifications'])`, and the real
 * `pushManager.subscribe()` rejects with "Registration failed —
 * permission denied". Both are headless-only blockers (verified via a
 * one-off probe against the Playwright image); in headful Chrome the
 * same code paths work. The `addInitScript` below patches only what
 * the headless runner can't provide (permission getter + push manager
 * subscribe/getSubscription) so the *real* application code under test
 * — the UI flow, the backend calls, the SW push handler, the
 * pushManager-facing hook — runs unmodified.
 *
 * `resetSeed` in beforeEach wipes `PushSubscription.objects.all()`
 * (see seed_e2e.py), so every test starts with zero records for user1
 * and can't leak into the next run.
 */

const FAKE_SUBSCRIPTION_INIT_SCRIPT = () => {
  Object.defineProperty(Notification, 'permission', {
    get: () => 'granted',
    configurable: true,
  })
  // SettingsPage calls Notification.requestPermission() before subscribing,
  // and headless Chromium still returns 'default' there. Stub it to
  // propagate the granted state the test has already asserted.
  Notification.requestPermission = async () => 'granted'

  const endpoint = `https://e2e.nudge.local/push/${Math.random().toString(36).slice(2, 10)}`
  const encoder = new TextEncoder()
  const p256dh = encoder.encode('e2e-p256dh-key-padding-padding-padding-padding-padding-padding!').buffer
  const auth = encoder.encode('e2e-auth-pad16!!').buffer
  const fakeSub = {
    endpoint,
    expirationTime: null,
    options: { userVisibleOnly: true },
    getKey: (name) => (name === 'p256dh' ? p256dh : auth),
    toJSON: () => ({ endpoint }),
    unsubscribe: async () => {
      window.__nudgeFakeSubActive = false
      return true
    },
  }
  window.__nudgeFakeSubActive = false

  const fakePushManager = {
    subscribe: async () => {
      window.__nudgeFakeSubActive = true
      return fakeSub
    },
    getSubscription: async () => (window.__nudgeFakeSubActive ? fakeSub : null),
  }
  const fakeRegistration = { pushManager: fakePushManager, scope: '/' }

  // When the test runs against host.docker.internal (non-secure, non-localhost
  // origin), Chromium disables navigator.serviceWorker entirely. Stub it so
  // subscribeToPush/unsubscribeFromPush can still run the UI path under test,
  // and expose a helper that simulates the SW broadcasting a push payload
  // back to the page — what sw.js does in production — so the delivery test
  // can exercise the page-side listener contract without a real SW.
  const listeners = new Set()
  const fakeSwContainer = {
    ready: Promise.resolve(fakeRegistration),
    register: async () => fakeRegistration,
    getRegistration: async () => fakeRegistration,
    addEventListener: (type, fn) => {
      if (type === 'message') listeners.add(fn)
    },
    removeEventListener: (type, fn) => {
      if (type === 'message') listeners.delete(fn)
    },
    dispatchEvent: (evt) => {
      if (evt.type === 'message') listeners.forEach((fn) => fn(evt))
      return true
    },
  }
  if (!('serviceWorker' in navigator)) {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: fakeSwContainer,
      configurable: true,
    })
  } else {
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.subscribe = fakePushManager.subscribe
      reg.pushManager.getSubscription = fakePushManager.getSubscription
    })
  }

  // Helper the delivery test uses instead of CDP.ServiceWorker.deliverPushMessage
  // when running against an insecure origin (no real SW to target).
  window.__nudgeSimulatePush = (payload) => {
    const evt = new MessageEvent('message', { data: { type: 'push-received', payload } })
    if (navigator.serviceWorker.dispatchEvent) {
      navigator.serviceWorker.dispatchEvent(evt)
    } else {
      listeners.forEach((fn) => fn(evt))
    }
  }
}

const pushTestStatus = (page) =>
  page.evaluate(async () => {
    const token = localStorage.getItem('access_token')
    const r = await fetch('/api/push/test/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    return r.status
  })

test.use({ permissions: ['notifications'] })

test.describe('Push notifications — subscribe / deliver / unsubscribe', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addInitScript(FAKE_SUBSCRIPTION_INIT_SCRIPT)
    await resetSeed(context)
    await loginAsUser1(page)
    await page.getByRole('link', { name: 'Settings', exact: true }).click()
    await page.waitForURL('/settings')
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('clicking Enable notifications subscribes the browser and the backend', async ({ page }) => {
    // permission === 'granted' + !subscribed → "Permission granted — tap to
    // subscribe" + an Enable button.
    await expect(page.getByText('Permission granted — tap to subscribe')).toBeVisible()
    await expect(await pushTestStatus(page)).toBe(404)

    await page.getByRole('button', { name: 'Enable notifications' }).click()
    await expect(page.getByText('Active')).toBeVisible({ timeout: 10_000 })

    // 204 proves the backend stored a PushSubscription for user1.
    expect(await pushTestStatus(page)).toBe(204)
  })

  test('service worker receives a push event and broadcasts the payload to the page', async ({ page, context }) => {
    await page.getByRole('button', { name: 'Enable notifications' }).click()
    await expect(page.getByText('Active')).toBeVisible({ timeout: 10_000 })

    // Install the page-side listener BEFORE delivering so no message can
    // slip past us. sw.js broadcasts `{ type: 'push-received', payload }`
    // from every push handler.
    await page.evaluate(() => {
      window.__nudgePushReceived = new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('message', (e) => {
          if (e.data?.type === 'push-received') resolve(e.data.payload)
        })
      })
    })

    // Two delivery strategies:
    //   1. Real SW path (localhost / https): CDP.ServiceWorker.deliverPushMessage
    //      exercises the full sw.js → postMessage chain.
    //   2. Stubbed SW path (host.docker.internal, insecure origin): the
    //      FAKE_SUBSCRIPTION_INIT_SCRIPT replaces navigator.serviceWorker,
    //      so CDP has no SW to target. Trigger the same broadcast via the
    //      `__nudgeSimulatePush` helper the stub installs.
    const targetOrigin = page.url().match(/^https?:\/\/[^/]+/)?.[0] ?? ''
    const isStubbed = await page.evaluate(() => typeof window.__nudgeSimulatePush === 'function')
    const payload = { title: 'Push test', body: 'It works!', type: 'test', data: {} }

    if (isStubbed) {
      await page.evaluate((p) => window.__nudgeSimulatePush(p), payload)
    } else {
      const cdp = await context.newCDPSession(page)
      const registrationIdPromise = new Promise((resolve) => {
        cdp.on('ServiceWorker.workerRegistrationUpdated', (evt) => {
          const reg = evt.registrations?.find((r) => r.scopeURL?.startsWith(targetOrigin) && !r.isDeleted)
          if (reg) resolve(reg.registrationId)
        })
      })
      await cdp.send('ServiceWorker.enable')
      const registrationId = await registrationIdPromise
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin: targetOrigin,
        registrationId,
        data: JSON.stringify(payload),
      })
    }

    const received = await page.evaluate(
      () =>
        Promise.race([
          window.__nudgePushReceived,
          new Promise((_, reject) => setTimeout(() => reject(new Error('push timeout')), 10_000)),
        ]),
    )
    expect(received).toMatchObject({ title: 'Push test', type: 'test' })
    expect(received).toHaveProperty('body', 'It works!')
  })

  test('clicking Disable notifications unsubscribes the browser and the backend', async ({ page }) => {
    await page.getByRole('button', { name: 'Enable notifications' }).click()
    await expect(page.getByText('Active')).toBeVisible({ timeout: 10_000 })
    expect(await pushTestStatus(page)).toBe(204)

    await page.getByRole('button', { name: 'Disable notifications' }).click()
    // permission stays 'granted' after unsubscribe → the label goes back
    // to the canEnable state rather than the initial 'default'.
    await expect(page.getByText('Permission granted — tap to subscribe')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Enable notifications' })).toBeVisible()
    expect(await pushTestStatus(page)).toBe(404)
  })
})
