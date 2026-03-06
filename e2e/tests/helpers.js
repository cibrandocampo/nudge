export const CREDS = {
  username: process.env.E2E_USERNAME ?? 'admin',
  password: process.env.E2E_PASSWORD ?? '',
}

export async function login(page) {
  await page.goto('/login')
  await page.getByPlaceholder('Username').fill(CREDS.username)
  await page.getByPlaceholder('Password').fill(CREDS.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')
}

export async function loginAs(page, username, password) {
  await page.goto('/login')
  await page.getByPlaceholder('Username').fill(username)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('/')
}

/**
 * Ensure a username is in the current user's contact list.
 * Requires the page to be logged in already.
 * Uses page.evaluate to call the API from the browser context.
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
