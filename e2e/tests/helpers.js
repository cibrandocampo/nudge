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
