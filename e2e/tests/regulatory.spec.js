import { test, expect } from '@playwright/test'
import { SEED } from './helpers/constants.js'
import { loginAsUser1, loginAsUser2, resetSeed } from './helpers/session.js'
import { goToStockDetail } from './helpers/navigation.js'
import { createStock } from './helpers/stocks.js'

/**
 * Regulatory data on the product page (T109–T113): the national code, the
 * "Medicine information" section and the official-name offer.
 *
 * Everything runs on the seed's recorded AEMPS data, never on the live agency:
 * a presentation the seed already fetched is never fetched again. That keeps
 * this spec identical in CI (fetching off) and locally (fetching on). Several
 * tests change the seed (a rename, a share), so each starts from a fresh one.
 */

const REG = SEED.regulatory
const apiBase = (process.env.BASE_URL ?? 'http://localhost:15173').replace(/:\d+(?=\b|\/|$)/, ':18000')

const offer = (page) => page.getByTestId('stock-values-confirm')
const section = (page) => page.getByTestId('regulatory-section')

test.describe('Regulatory data on the product page', () => {
  test.beforeEach(async ({ context }) => {
    await resetSeed(context)
  })

  test('shows the active supply problem of the seeded insulin', async ({ page }) => {
    await loginAsUser1(page)
    await goToStockDetail(page, 'fastInsulin')
    // The seed leaves this stock's name offer pending: answer it first.
    await page.getByTestId('stock-values-keep').click()
    await expect(offer(page)).toHaveCount(0)

    await expect(section(page).getByTestId('regulatory-official-name')).toHaveText(REG.fastInsulin.officialName)
    await expect(section(page).getByText('Source: AEMPS (CIMA)', { exact: false })).toBeVisible()
    await expect(section(page).getByTestId('regulatory-supply-chip')).toHaveAttribute('data-tone', 'danger')
    const problem = section(page).getByTestId('regulatory-active-problem')
    await expect(problem).toContainText('See the AEMPS information note')
    await expect(problem.getByRole('link')).toHaveAttribute('href', /^https:\/\/www\.aemps\.gob\.es\//)
  })

  test('accepting the official name renames the stock for good', async ({ page }) => {
    await loginAsUser1(page)
    await goToStockDetail(page, 'fastInsulin')
    await expect(offer(page)).toContainText(SEED.stocks.fastInsulin)
    await expect(offer(page)).toContainText(REG.fastInsulin.officialName)

    await page.getByTestId('stock-values-update').click()
    await expect(offer(page)).toHaveCount(0)
    // The header now carries the official name, as does the section.
    await expect(page.getByText(REG.fastInsulin.officialName)).toHaveCount(2)

    await page.reload()
    await expect(section(page)).toBeVisible()
    await expect(offer(page)).toHaveCount(0)
    await expect(page.getByText(SEED.stocks.fastInsulin)).toHaveCount(0)
  })

  test('keeping the name answers the offer once and for all', async ({ page }) => {
    await loginAsUser1(page)
    await goToStockDetail(page, 'fastInsulin')
    await page.getByTestId('stock-values-keep').click()
    await expect(offer(page)).toHaveCount(0)

    await page.reload()
    await expect(section(page)).toBeVisible()
    await expect(offer(page)).toHaveCount(0)
    await expect(page.getByText(SEED.stocks.fastInsulin).first()).toBeVisible()
  })

  test("lists Hidroferol's safety notices and asks nothing", async ({ page }) => {
    await loginAsUser1(page)
    // Pinned in the seed, so it renders twice in the inventory — the helper
    // opens the first one.
    await goToStockDetail(page, 'hidroferol')
    const notices = section(page).getByTestId('regulatory-notices')
    await expect(notices.getByRole('listitem')).toHaveCount(REG.hidroferol.safetyNotices)
    await expect(notices.getByRole('link').first()).toHaveAttribute('href', /^https:\/\/www\.aemps\.gob\.es\//)
    await expect(offer(page)).toHaveCount(0)
  })

  test('a stock with a foreign GTIN has no medicine information', async ({ page }) => {
    await loginAsUser1(page)
    await goToStockDetail(page, 'metformin')
    await expect(page.getByTestId('add-lot-toggle')).toBeVisible()
    await expect(section(page)).toHaveCount(0)
  })

  test('a guest sees the data but neither the refresh nor the offer', async ({ page, context }) => {
    // Share the insulin — whose offer is pending for its owner — with user2,
    // through the API, as the owner.
    const auth = await context.request.post(`${apiBase}/api/auth/token/`, {
      data: { username: SEED.user1.username, password: SEED.user1.password },
    })
    const headers = { Authorization: `Bearer ${(await auth.json()).access}` }
    const contacts = await (await context.request.get(`${apiBase}/api/auth/contacts/`, { headers })).json()
    const maria = (contacts.results ?? contacts).find((c) => c.email === SEED.user2.email)
    const stocks = await (await context.request.get(`${apiBase}/api/stock/?page_size=100`, { headers })).json()
    const insulin = stocks.results.find((s) => s.name === SEED.stocks.fastInsulin)
    const shared = await context.request.patch(`${apiBase}/api/stock/${insulin.id}/`, {
      // An HTTP-date, as the app's own client sends it (`api/client.js`).
      headers: {
        ...headers,
        'If-Unmodified-Since': new Date(insulin.updated_at).toUTCString(),
        'Idempotency-Key': `t114-${Date.now()}`,
      },
      data: { shared_with: [maria.id] },
    })
    expect(shared.status()).toBe(200)

    await loginAsUser2(page)
    await goToStockDetail(page, 'fastInsulin')
    await expect(section(page).getByTestId('regulatory-official-name')).toHaveText(REG.fastInsulin.officialName)
    await expect(section(page).getByTestId('regulatory-refresh')).toHaveCount(0)
    await expect(offer(page)).toHaveCount(0)
  })

  test('a typed CN is normalised and links the stock to its medicine', async ({ page }) => {
    await loginAsUser1(page)
    const name = 'Insulin pen T114'
    await createStock(page, { name })
    await goToStockDetail(page, name)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByTestId('national-code-input').fill(`${REG.fastInsulin.cn}.4`)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/inventory\/\d+$/)

    // The code points at a presentation the seed already fetched, so the data
    // is there at once — and so is the first-link name offer.
    await expect(offer(page)).toContainText(REG.fastInsulin.officialName)
    await page.getByTestId('stock-values-keep').click()
    await expect(section(page).getByTestId('regulatory-official-name')).toHaveText(REG.fastInsulin.officialName)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByTestId('national-code-input')).toHaveValue(REG.fastInsulin.cn)
  })

  test("the CN of a Spanish GTIN is shown derived and locked in the form", async ({ page }) => {
    await loginAsUser1(page)
    await goToStockDetail(page, 'ibuprofen')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const cn = page.getByTestId('national-code-input')
    await expect(cn).toHaveValue(REG.ibuprofen.cn)
    await expect(cn).toHaveAttribute('readonly', '')
    await expect(page.getByText('taken from the product code')).toBeVisible()
  })
})
