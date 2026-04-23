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
    await ensureContact(page, USER2.username)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
  })

  test('share popover appears on routine cards', async ({ page }) => {
    // Should be on dashboard after login
    await expect(page.getByText('Today')).toBeVisible()

    // Look for at least one share button (👥) on the page
    const shareButtons = page.getByRole('button', { name: 'Share' })
    const count = await shareButtons.count()

    if (count === 0) {
      // No routines on dashboard — create one first
      await page.getByRole('link', { name: '+ New routine' }).click()
      await page.getByPlaceholder(/change water filter/i).fill(`Share test ${Date.now()}`)
      await page.getByRole('button', { name: 'Save' }).click()
      await page.waitForURL(/\/routines\/\d+$/)

      // Go back to dashboard
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'Share' }).first()).toBeVisible()
    }

    // Click the first share button
    await page.getByRole('button', { name: 'Share' }).first().click()

    // Modal should open with a contact listed
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(USER2.username)).toBeVisible()
  })

  test('share routine via API and verify dashboard reflects it', async ({ page }) => {
    // Create a routine
    await page.getByRole('link', { name: '+ New routine' }).click()
    const routineName = `Shared routine ${Date.now()}`
    await page.getByPlaceholder(/change water filter/i).fill(routineName)
    await page.getByRole('button', { name: 'Save' }).click()
    await page.waitForURL(/\/routines\/\d+$/)

    const routineId = page.url().match(/\/routines\/(\d+)$/)[1]

    // Share via API (the checkbox inside RoutineCard Link causes navigation — known issue)
    await page.evaluate(
      async ({ rid, contactUsername }) => {
        const token = localStorage.getItem('access_token')
        const headers = {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
        const contactsRes = await fetch('/api/auth/contacts/', { headers })
        const contacts = await contactsRes.json()
        const contact = contacts.find((c) => c.username === contactUsername)
        if (!contact) throw new Error(`Contact ${contactUsername} not found`)

        await fetch(`/api/routines/${rid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ shared_with: [contact.id] }),
        })
      },
      { rid: routineId, contactUsername: USER2.username },
    )

    // Go to dashboard and find the specific routine card
    await page.goto('/')
    const card = page.getByTestId('routine-card').filter({ hasText: routineName })
    await expect(card).toBeVisible()

    // Open share modal for this specific routine and verify contact is selected
    await card.getByRole('button', { name: 'Share' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('li').filter({ hasText: USER2.username })).toHaveClass(/itemSelected/)
  })

  test('shared routine visible to second user', async ({ page, context }) => {
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
        const contact = contacts.find((c) => c.username === contactUsername)
        if (!contact) throw new Error(`Contact ${contactUsername} not found`)

        // Share routine with contact
        await fetch(`/api/routines/${rid}/`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ shared_with: [contact.id] }),
        })
      },
      { rid: routineId, contactUsername: USER2.username },
    )

    // Login as second user in a new page
    const page2 = await context.newPage()
    await loginAs(page2, USER2.username, USER2.password)

    // The shared routine should appear on user2's dashboard
    await expect(page2.getByText(routineName)).toBeVisible({ timeout: 10000 })

    // It should show the owner label (admin username)
    await expect(page2.getByText(SEED.admin.username).first()).toBeVisible()

    await page2.close()
  })
})

test.describe('Sharing — Inventory', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await ensureContact(page, USER2.username)
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
    await expect(dialog.getByText(USER2.username)).toBeVisible()
  })

  test('stock shared from the form is persisted and shows a shared badge', async ({ page }) => {
    const name = `Shared stock ${Date.now()}`

    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name').fill(name)

    // Open share modal, pick USER2, close with Escape.
    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('li').filter({ hasText: USER2.username }).click()
    await expect(dialog.locator('li').filter({ hasText: USER2.username })).toHaveClass(/itemSelected/)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()

    // A chip with the contact should render below the Share with button.
    await expect(page.getByText(USER2.username, { exact: true })).toBeVisible()

    // Submit the form and confirm we land on the detail page.
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    // Inventory list should show the card with the shared badge for the owner.
    await page.getByRole('link', { name: /back to inventory/i }).click()
    const card = page.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(card).toBeVisible()
    await expect(card.getByTestId('shared-badge')).toBeVisible()
  })

  test('shared stock is visible to the recipient with owner label', async ({ page, context }) => {
    // Create a stock shared with USER2 as admin.
    const name = `Stock for user2 ${Date.now()}`
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByLabel('Name').fill(name)

    await page.getByRole('button', { name: 'Share with…', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('li').filter({ hasText: USER2.username }).click()
    await page.keyboard.press('Escape')

    await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('/api/stock/') && res.request().method() === 'POST' && res.status() === 201,
      ),
      page.getByRole('button', { name: 'Create' }).click(),
    ])
    await expect(page).toHaveURL(/\/inventory\/\d+$/)

    // USER2 logs in on a separate page and visits Inventory.
    const page2 = await context.newPage()
    await loginAs(page2, USER2.username, USER2.password)
    await page2.getByRole('link', { name: 'Inventory' }).click()
    await expect(page2).toHaveURL('/inventory')

    const sharedCard = page2.locator('[data-testid="product-card"]').filter({ hasText: name })
    await expect(sharedCard).toBeVisible({ timeout: 10_000 })

    // The recipient sees the admin username as the owner label, no shared badge.
    await expect(sharedCard.getByText(SEED.admin.username)).toBeVisible()
    await expect(sharedCard.getByTestId('shared-badge')).toHaveCount(0)

    await page2.close()
  })
})
