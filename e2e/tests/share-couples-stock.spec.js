import { test, expect } from '@playwright/test'
import { ensureContact, loginAs, loginAsUser1, resetSeed, SEED } from './helpers.js'

/**
 * Coupled share E2E (T132).
 *
 * The owner edits a routine that has a linked stock and adds a recipient
 * who does NOT yet have access to that stock. The form submits via a
 * confirmation popup that, when accepted, shares stock first then
 * routine; cancel leaves both untouched.
 *
 * Uses `Replace glucose sensor` + its linked stock `Glucose monitor
 * sensors` — both owned by user1 and unshared at seed time. `resetSeed()`
 * runs before every test so the starting state is deterministic.
 */

const ROUTINE_NAME = SEED.routines.replaceGlucoseSensor
const STOCK_NAME = SEED.stocks.glucoseSensors
const USER2 = SEED.user2

async function findRoutineByName(page, name) {
  return page.evaluate(async (routineName) => {
    const token = localStorage.getItem('access_token')
    const headers = { Authorization: `Bearer ${token}` }
    const res = await fetch('/api/routines/', { headers })
    const data = await res.json()
    const list = data.results ?? data
    const routine = list.find((r) => r.name === routineName)
    if (!routine) throw new Error(`Routine "${routineName}" not found`)
    return { routineId: routine.id, stockId: routine.stock }
  }, name)
}

async function fetchRoutine(page, routineId) {
  return page.evaluate(async (id) => {
    const token = localStorage.getItem('access_token')
    const res = await fetch(`/api/routines/${id}/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.json()
  }, routineId)
}

async function fetchStock(page, stockId) {
  return page.evaluate(async (id) => {
    const token = localStorage.getItem('access_token')
    const res = await fetch(`/api/stock/${id}/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.json()
  }, stockId)
}

async function fetchUser2Id(page) {
  return page.evaluate(async (uname) => {
    const token = localStorage.getItem('access_token')
    const res = await fetch('/api/auth/contacts/', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const contacts = await res.json()
    const user = contacts.find((c) => c.email === uname)
    if (!user) throw new Error(`Contact ${uname} not found`)
    return user.id
  }, USER2.email)
}

test.describe('Coupled share — routine with linked stock', () => {
  test.beforeEach(async ({ context, page }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    // Seed already adds user2 as a mutual contact; this is a no-op safety net
    // in case the contact graph drifts.
    await ensureContact(page, USER2.email)
  })

  test('accepting the popup shares routine and stock', async ({ page, browser }) => {
    const { routineId, stockId } = await findRoutineByName(page, ROUTINE_NAME)
    const user2Id = await fetchUser2Id(page)

    // Pre-state sanity: neither resource is shared with user2 yet.
    const routineBefore = await fetchRoutine(page, routineId)
    const stockBefore = await fetchStock(page, stockId)
    expect(routineBefore.shared_with).not.toContain(user2Id)
    expect(stockBefore.shared_with).not.toContain(user2Id)

    // RoutineFormPage's coupled-share check reads stock from the React Query
    // cache (`findCachedStock`); the form mounts a `useStockList()` itself,
    // so `goto` triggers `GET /api/stock/`. Wait for it before submitting.
    const stockListReady = page.waitForResponse(
      (res) =>
        /\/api\/stock\/?(\?|$)/.test(res.url()) &&
        res.request().method() === 'GET' &&
        res.ok(),
    )
    await page.goto(`/routines/${routineId}/edit`)
    await stockListReady
    // The form prefills `usesStock` from `routine.stock` inside a useEffect
    // after `useRoutine` resolves. Waiting for the Stock tracking toggle to
    // flip to checked guarantees the prefill ran — without it, `payload.stock`
    // can race to `null` and the popup never fires.
    await expect(page.getByRole('switch', { name: 'Stock tracking' })).toBeChecked()

    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const shareDialog = page.getByRole('dialog')
    await expect(shareDialog).toBeVisible()
    await shareDialog.locator('li').filter({ hasText: USER2.name }).click()
    await page.keyboard.press('Escape')
    await expect(shareDialog).toBeHidden()

    await page.getByRole('button', { name: 'Save' }).click()

    // Coupled-share popup — message interpolates stock name + recipient list.
    const popup = page.getByRole('dialog')
    await expect(popup).toBeVisible()
    await expect(popup.getByText(STOCK_NAME)).toBeVisible()
    await expect(popup.getByText(USER2.name)).toBeVisible()

    await Promise.all([
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/stock/${stockId}/`) &&
          res.request().method() === 'PATCH' &&
          res.ok(),
      ),
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/routines/${routineId}/`) &&
          res.request().method() === 'PATCH' &&
          res.ok(),
      ),
      popup.getByRole('button', { name: 'Share both' }).click(),
    ])

    await page.waitForURL(`/routines/${routineId}`)

    // Backend confirms both ends of the coupled share were applied.
    const routineAfter = await fetchRoutine(page, routineId)
    const stockAfter = await fetchStock(page, stockId)
    expect(routineAfter.shared_with).toContain(user2Id)
    expect(stockAfter.shared_with).toContain(user2Id)

    // user2 sees the routine on their dashboard and the stock in inventory.
    // Use a fresh BrowserContext so AuthContext does not inherit user1's
    // localStorage / IndexedDB state — same pattern as sharing.spec.js.
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    try {
      await loginAs(page2, USER2.email, USER2.password)
      await expect(
        page2.getByTestId('routine-card').filter({ hasText: ROUTINE_NAME }),
      ).toBeVisible({ timeout: 10_000 })

      await page2.getByRole('link', { name: 'Inventory', exact: true }).click()
      await expect(page2).toHaveURL('/inventory')
      await expect(
        page2.getByTestId('product-card').filter({ hasText: STOCK_NAME }),
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await ctx2.close()
    }
  })

  test('cancelling the popup leaves nothing shared', async ({ page }) => {
    const { routineId, stockId } = await findRoutineByName(page, ROUTINE_NAME)
    const user2Id = await fetchUser2Id(page)

    const stockListReady = page.waitForResponse(
      (res) =>
        /\/api\/stock\/?(\?|$)/.test(res.url()) &&
        res.request().method() === 'GET' &&
        res.ok(),
    )
    await page.goto(`/routines/${routineId}/edit`)
    await stockListReady
    // The form prefills `usesStock` from `routine.stock` inside a useEffect
    // after `useRoutine` resolves. Waiting for the Stock tracking toggle to
    // flip to checked guarantees the prefill ran — without it, `payload.stock`
    // can race to `null` and the popup never fires.
    await expect(page.getByRole('switch', { name: 'Stock tracking' })).toBeChecked()

    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const shareDialog = page.getByRole('dialog')
    await expect(shareDialog).toBeVisible()
    await shareDialog.locator('li').filter({ hasText: USER2.name }).click()
    await page.keyboard.press('Escape')
    await expect(shareDialog).toBeHidden()

    await page.getByRole('button', { name: 'Save' }).click()

    const popup = page.getByRole('dialog')
    await expect(popup).toBeVisible()
    await popup.getByRole('button', { name: 'Cancel' }).click()
    await expect(popup).toBeHidden()

    // No PATCH should have fired. Read the resources fresh from the backend
    // — bypassing any local cache — and confirm user2 is still absent.
    const routineAfter = await fetchRoutine(page, routineId)
    const stockAfter = await fetchStock(page, stockId)
    expect(routineAfter.shared_with).not.toContain(user2Id)
    expect(stockAfter.shared_with).not.toContain(user2Id)

    // Form is still on the edit page (popup cancel does not navigate).
    await expect(page).toHaveURL(`/routines/${routineId}/edit`)
  })
})
