import { test, expect } from '@playwright/test'
import { login, loginAs, SEED, ensureContact } from './helpers.js'

/**
 * Sharing E2E tests.
 *
 * Uses the admin (E2E_USERNAME/E2E_PASSWORD) as the sharer and `user2`
 * from the seed fixture (T073) as the recipient. Mutual contact edges
 * between admin and user2 are guaranteed by `ensureContact` at the top
 * of each describe.
 */

const USER2 = SEED.user2

test.describe('Sharing — Routines', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await ensureContact(page, USER2.email)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('share modal lists contacts when opened from the routine form', async ({ page }) => {
    // The old popover on routine cards was replaced by a ShareWithSection
    // (→ ShareModal) inside the routine form. Open the "New routine" form
    // and confirm the modal renders and lists the seeded contact.
    await page.getByRole('link', { name: '+ New routine' }).click()
    await expect(page).toHaveURL('/routines/new')

    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(USER2.name)).toBeVisible()
  })

  test('share routine via API and verify the edit form reflects it', async ({ page }) => {
    // Create a routine
    await page.getByRole('link', { name: '+ New routine' }).click()
    const routineName = `Shared routine ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(routineName)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    const routineId = page.url().match(/\/routines\/(\d+)$/)[1]

    // Share via API — RoutineCard has no Share trigger; sharing is edited
    // from the routine form, so setting via API + re-opening the form is
    // the equivalent end-to-end round-trip.
    await page.evaluate(
      async ({ rid, contactUsername }) => {
        const token = localStorage.getItem('access_token')
        const headers = {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
        const contactsRes = await fetch('/api/auth/contacts/', { headers })
        const contacts = await contactsRes.json()
        const contact = contacts.find((c) => c.email === contactUsername)
        if (!contact) throw new Error(`Contact ${contactUsername} not found`)

        await fetch(`/api/routines/${rid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ shared_with: [contact.id] }),
        })
      },
      { rid: routineId, contactUsername: USER2.email },
    )

    // Dashboard: the card should carry the passive shared badge.
    await page.goto('/')
    const card = page.getByTestId('routine-card').filter({ hasText: routineName })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('shared-badge')).toBeVisible()

    // Open the routine's edit form — the ShareModal should show USER2
    // as already selected.
    await page.goto(`/routines/${routineId}/edit`)
    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('li').filter({ hasText: USER2.name })).toHaveClass(/itemSelected/)
  })

  test('shared routine visible to second user', async ({ page, browser }) => {
    // Create a routine as admin
    await page.getByRole('link', { name: '+ New routine' }).click()
    const routineName = `Visible to user2 ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(routineName)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    // Share it via API (avoids popover interaction issues inside Link cards)
    const routineId = page.url().match(/\/routines\/(\d+)$/)[1]
    await page.evaluate(
      async ({ rid, contactUsername }) => {
        const token = localStorage.getItem('access_token')
        const headers = {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
        // Get contact ID
        const contactsRes = await fetch('/api/auth/contacts/', { headers })
        const contacts = await contactsRes.json()
        const contact = contacts.find((c) => c.email === contactUsername)
        if (!contact) throw new Error(`Contact ${contactUsername} not found`)

        // Share routine with contact
        await fetch(`/api/routines/${rid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ shared_with: [contact.id] }),
        })
      },
      { rid: routineId, contactUsername: USER2.email },
    )

    // Open the recipient's session in a fresh browser context so the
    // tab does not inherit admin's localStorage / IDB / cookies. Sharing
    // the same context (via `context.newPage()`) leaves AuthContext
    // hydrated as admin even after `loginAs(user2)` because the
    // persisted query cache and the token live in shared origin
    // storage.
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    await loginAs(page2, USER2.email, USER2.password)

    // The shared routine should appear on user2's dashboard
    await expect(page2.getByText(routineName)).toBeVisible({ timeout: 10000 })

    // The recipient sees the outlined badge variant; the owner username
    // lives inside its aria-label (the inline label was removed in T134).
    const sharedCard = page2.locator('[data-testid="routine-card"]').filter({ hasText: routineName })
    const badge = sharedCard.getByTestId('shared-badge')
    await expect(badge).toHaveAttribute('data-variant', 'recipient')
    await expect(badge).toHaveAttribute('aria-label', new RegExp(SEED.admin.name))

    await ctx2.close()
  })
})

test.describe('Sharing — Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await ensureContact(page, USER2.email)
    await page.getByRole('link', { name: 'Inventory' }).click()
    await expect(page).toHaveURL('/inventory')
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('share modal lists contacts when opened from the stock form', async ({ page }) => {
    // Sharing for stock happens on the form page (ShareWithSection), not on
    // the list card. Navigate into the "New product" form and open the modal.
    await page.getByRole('button', { name: '+ New' }).click()
    await expect(page).toHaveURL('/inventory/new')

    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(USER2.name)).toBeVisible()
  })

  test('stock shared from the form is persisted and shows a shared badge', async ({ page }) => {
    const name = `Shared stock ${Date.now()}`

    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/ibuprofen/i).fill(name)

    // Open share modal, pick USER2, close with Escape.
    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('li').filter({ hasText: USER2.name }).click()
    await expect(dialog.locator('li').filter({ hasText: USER2.name })).toHaveClass(/itemSelected/)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // A chip with the contact should render below the Share with button.
    await expect(page.getByText(USER2.name, { exact: true })).toBeVisible()

    // Submit the form and confirm we land on the detail page.
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    // Inventory list should show the card with the shared badge for the owner.
    await page.getByRole('link', { name: /back to inventory/i }).click()
    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('shared-badge')).toBeVisible()
  })

  test('shared stock is visible to the recipient with owner label', async ({ page, browser }) => {
    // Create a stock shared with USER2 as admin.
    const name = `Stock for user2 ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/ibuprofen/i).fill(name)

    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('li').filter({ hasText: USER2.name }).click()
    await page.keyboard.press('Escape')

    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/stock/') && res.request().method() === 'POST' && res.status() === 201,
      ),
      page.getByRole('button', { name: 'Create' }).click(),
    ])
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    // USER2 logs in on a fresh BrowserContext (separate localStorage /
    // IDB / cookies) so AuthContext doesn't keep admin's session. With
    // a shared context, the persisted ['me'] cache + the access token
    // hydrate as admin before our login form fill applies, and the page
    // never actually flips to user2.
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    await loginAs(page2, USER2.email, USER2.password)
    await page2.getByRole('link', { name: 'Inventory' }).click()
    await expect(page2).toHaveURL('/inventory')

    const sharedCard = page2.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(sharedCard).toBeVisible({ timeout: 10_000 })

    // The recipient now sees the outlined badge variant; the admin username
    // lives inside the badge's aria-label (the inline label was dropped in T134).
    const badge = sharedCard.getByTestId('shared-badge')
    await expect(badge).toHaveAttribute('data-variant', 'recipient')
    await expect(badge).toHaveAttribute('aria-label', new RegExp(SEED.admin.name))

    await ctx2.close()
  })
})
