import { SEED } from './constants.js'

export async function login(page) {
  await loginAs(page, SEED.admin.username, SEED.admin.password)
}

export async function loginAs(page, username, password) {
  await page.goto('/login')
  await page.getByPlaceholder('Username').fill(username)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')
}

export async function loginAsAdmin(page) {
  return loginAs(page, SEED.admin.username, SEED.admin.password)
}

export async function loginAsUser1(page) {
  return loginAs(page, SEED.user1.username, SEED.user1.password)
}

export async function loginAsUser2(page) {
  return loginAs(page, SEED.user2.username, SEED.user2.password)
}

export async function loginAsUser3(page) {
  return loginAs(page, SEED.user3.username, SEED.user3.password)
}

/**
 * Wipe browser state (cookies + IndexedDB + localStorage) and optionally log
 * in. Used by offline specs that must not inherit state between tests.
 * @param {{ loginAs?: 'admin'|'user1'|'user2'|'user3' }} opts
 */
export async function freshSession(page, context, { loginAs: who } = {}) {
  await context.clearCookies()
  await page.goto('/login')
  await page.evaluate(async () => {
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases()
      await Promise.all(dbs.map((db) => indexedDB.deleteDatabase(db.name)))
    }
    localStorage.clear()
  })
  if (who === 'admin') await loginAsAdmin(page)
  else if (who === 'user1') await loginAsUser1(page)
  else if (who === 'user2') await loginAsUser2(page)
  else if (who === 'user3') await loginAsUser3(page)
}

/**
 * Sign out via the header user menu and wait for the /login redirect.
 * Uses `exact: true` to avoid matching the "Admin" Django link button.
 */
export async function logout(page) {
  const username =
    (await page.evaluate(() => {
      const token = localStorage.getItem('access_token')
      if (!token) return null
      try {
        return JSON.parse(atob(token.split('.')[1])).username ?? null
      } catch {
        return null
      }
    })) ?? SEED.admin.username
  await page.getByRole('button', { name: username, exact: true }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL('/login')
}

/**
 * Reset the backend to the T073 seed state. Useful when several tests in
 * the same spec mutate server data and need deterministic starting points
 * (T071 uses it per-test so backoff / conflict / abort scenarios don't
 * inherit each other's side effects).
 *
 * Hits the same internal endpoint as `global-setup.js`. No authentication
 * required — the backend gate is either `DEBUG=True` or
 * `E2E_SEED_ALLOWED=true`.
 */
export async function resetSeed(context) {
  const base = process.env.BASE_URL ?? 'http://localhost:5173'
  const apiBase = base.replace(/:\d+(?=\b|\/|$)/, ':8000')
  const res = await context.request.post(`${apiBase}/api/internal/e2e-seed/`)
  if (res.status() !== 204) {
    throw new Error(`resetSeed failed: expected 204, got ${res.status()}`)
  }
}

/**
 * Ensure `username` is in the current user's contact list via the API (not
 * the UI). Works regardless of where the test currently is.
 */
export async function ensureContact(page, username) {
  await page.evaluate(async (contactUsername) => {
    const token = localStorage.getItem('access_token')
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    const res = await fetch('/api/auth/contacts/', { headers })
    const contacts = await res.json()
    if (contacts.some((c) => c.username === contactUsername)) return
    await fetch('/api/auth/contacts/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ username: contactUsername }),
    })
  }, username)
}
