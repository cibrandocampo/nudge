import { test, expect } from '@playwright/test'
import { login } from './helpers.js'

/**
 * End-to-end tests for the scheduled test notification feature.
 *
 * Verifies the POST /api/push/test/scheduled/ endpoint via authenticated
 * browser context (real JWT, real database).
 */

const FAKE_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/e2e-scheduled-test'
const FAKE_SUB = {
  endpoint: FAKE_ENDPOINT,
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfWLk',
    auth: 'tBHItJI5svbpC7htL0Rrg',
  },
}

const apiCall = (page, method, path, body) =>
  page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem('access_token')
      const res = await fetch(path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    },
    { method, path, body },
  )

test.describe('Scheduled test notification', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('returns 202 and enqueues Celery task', async ({ page }) => {
    // Ensure a push subscription exists
    await apiCall(page, 'POST', '/api/push/subscribe/', FAKE_SUB)

    // Schedule the test notification
    const result = await apiCall(page, 'POST', '/api/push/test/scheduled/', null)
    expect(result.status).toBe(202)

    // Clean up
    await apiCall(page, 'DELETE', '/api/push/unsubscribe/', { endpoint: FAKE_ENDPOINT })
  })

  test('returns 404 without push subscriptions', async ({ page }) => {
    // Remove any leftover subscription from other tests
    await apiCall(page, 'DELETE', '/api/push/unsubscribe/', { endpoint: FAKE_ENDPOINT })

    const result = await apiCall(page, 'POST', '/api/push/test/scheduled/', null)
    expect(result.status).toBe(404)
  })
})
