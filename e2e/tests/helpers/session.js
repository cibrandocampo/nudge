import { SEED } from './constants.js'

export async function login(page) {
  await loginAs(page, SEED.admin.email, SEED.admin.password)
}

/**
 * Log in via the email-based wizard (T193+): enter email → Continue →
 * (password users) enter password → Sign in. All seeded users —
 * admin + cibran/maria/laura — are `auth_method='password'`, so they
 * always take the password branch.
 */
export async function loginAs(page, email, password) {
  await page.goto('/login')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // Accounts with no name yet (e.g. the bootstrap admin) land on a
  // one-time onboarding step before the dashboard. Race the two outcomes
  // so users that already have a name (the demo seed users) incur no delay.
  const firstName = page.getByPlaceholder('First name')
  await Promise.race([
    page.waitForURL('/'),
    firstName.waitFor({ state: 'visible' }),
  ])
  if (await firstName.isVisible().catch(() => false)) {
    await firstName.fill('Admin')
    await page.getByPlaceholder('Last name').fill('User')
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.waitForURL('/')
  }
}

export async function loginAsAdmin(page) {
  return loginAs(page, SEED.admin.email, SEED.admin.password)
}

export async function loginAsUser1(page) {
  return loginAs(page, SEED.user1.email, SEED.user1.password)
}

export async function loginAsUser2(page) {
  return loginAs(page, SEED.user2.email, SEED.user2.password)
}

export async function loginAsUser3(page) {
  return loginAs(page, SEED.user3.email, SEED.user3.password)
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
 * Sign out via the Header's direct log-out button and wait for the
 * /login redirect. The old user-menu dropdown was replaced by a single
 * button with `aria-label="Sign out"` — the change-password action now
 * lives under Settings → Profile.
 */
export async function logout(page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
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
  const base = process.env.BASE_URL ?? 'http://localhost:15173'
  const apiBase = base.replace(/:\d+(?=\b|\/|$)/, ':18000')
  const res = await context.request.post(`${apiBase}/api/internal/seed/`)
  if (res.status() !== 204) {
    throw new Error(`resetSeed failed: expected 204, got ${res.status()}`)
  }
}

/**
 * Ensure `email` is in the current user's contact list via the API (not
 * the UI). Works regardless of where the test currently is. Contacts are
 * keyed by email (T197): the API adds by exact email match and the
 * serializer exposes `email`, not `username`.
 */
export async function ensureContact(page, email) {
  await page.evaluate(async (contactEmail) => {
    const token = localStorage.getItem('access_token')
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    const res = await fetch('/api/auth/contacts/', { headers })
    const contacts = await res.json()
    if (contacts.some((c) => c.email === contactEmail)) return
    await fetch('/api/auth/contacts/', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: contactEmail }),
    })
  }, email)
}
