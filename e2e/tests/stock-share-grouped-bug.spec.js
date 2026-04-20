/**
 * Demo test: shared stock in an owner's group is visible to the recipient.
 *
 * BUG (fixed): stocks assigned to a group owned by user A were invisible to
 * user B (the recipient) because the frontend filtered them into neither the
 * grouped sections (user B doesn't have that group) nor the ungrouped list
 * (st.group was non-null). Fix: treat stocks whose group is not in the
 * current user's groups as ungrouped.
 */

import { test, expect } from '@playwright/test'
import { login, loginAs, ensureContact, SEED } from './helpers.js'
import path from 'path'
import fs from 'fs'

// Recipient user comes from the seed (T073), not ad-hoc env vars.
const USER2 = SEED.user2

const SCREENSHOTS_DIR = '/tmp/nudge-share-demo'

function saveScreenshot(page, name) {
  return page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`), fullPage: true })
}

test.beforeAll(() => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })
})

test.setTimeout(60_000)

test('shared stock in a group is visible to recipient (grouped-stock bug)', async ({ page, context }) => {
  // ── 1. Login as admin ──────────────────────────────────────────────────
  await login(page)
  await ensureContact(page, USER2.username)
  await expect(page.getByTestId('offline-banner')).toBeHidden()

  // ── 2. Navigate to Inventory ───────────────────────────────────────────
  await page.getByRole('link', { name: 'Inventory' }).click()
  await expect(page).toHaveURL('/inventory')

  const groupName = `Demo Group ${Date.now()}`
  const stockName = `Demo Stock ${Date.now()}`

  // ── 3. Create a stock group via the Categories modal ───────────────────
  // Button text: t('inventory.manageGroups') = "Categories"
  await page.getByRole('button', { name: 'Categories' }).click()
  const groupManagerModal = page.getByRole('dialog')
  await expect(groupManagerModal).toBeVisible()

  // Input placeholder: t('inventory.groupName') = "Category name"
  await groupManagerModal.getByPlaceholder('Category name').fill(groupName)
  // Submit button: t('inventory.createGroup') = "Create"
  await groupManagerModal.getByRole('button', { name: 'Create' }).click()
  await expect(groupManagerModal.getByText(groupName)).toBeVisible()
  await groupManagerModal.getByRole('button', { name: 'Close' }).click()
  await expect(groupManagerModal).not.toBeVisible()

  // ── 4. Create a stock item ─────────────────────────────────────────────
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByPlaceholder(/item name/i).fill(stockName)
  await page.getByRole('button', { name: 'Create item' }).click()

  const ownerCard = page.locator('[data-testid="product-card"]').filter({ hasText: stockName })
  await expect(ownerCard).toBeVisible()

  // ── 5. Assign the stock to the group ──────────────────────────────────
  // Button title: t('inventory.assignGroup') = "Category"
  await ownerCard.getByTitle('Category').click()
  const groupPickerModal = page.getByRole('dialog')
  await expect(groupPickerModal).toBeVisible()
  await groupPickerModal.getByText(groupName).click()
  // Group picker closes after selection
  await expect(groupPickerModal).not.toBeVisible()
  // Stock now appears in the group section
  await expect(page.locator('[data-testid="group-box"]').filter({ hasText: groupName })).toBeVisible()

  // ── 6. Share the stock with user2 via API ─────────────────────────────
  await page.evaluate(
    async ({ sName, contactUsername }) => {
      const token = localStorage.getItem('access_token')
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

      const contacts = await fetch('/api/auth/contacts/', { headers }).then((r) => r.json())
      const contact = contacts.find((c) => c.username === contactUsername)
      if (!contact) throw new Error(`Contact ${contactUsername} not found`)

      const stocks = await fetch('/api/stock/', { headers }).then((r) => r.json())
      const stockList = stocks.results ?? stocks
      const stock = stockList.find((s) => s.name === sName)
      if (!stock) throw new Error(`Stock ${sName} not found`)

      const res = await fetch(`/api/stock/${stock.id}/`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ shared_with: [contact.id] }),
      })
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
    },
    { sName: stockName, contactUsername: USER2.username },
  )

  // ── Screenshot 1: owner's inventory (stock inside a group) ────────────
  await page.reload()
  const groupBox = page.locator('[data-testid="group-box"]').filter({ hasText: groupName })
  await expect(groupBox).toBeVisible()
  const ownerCardInGroup = page.locator('[data-testid="product-card"]').filter({ hasText: stockName })
  await expect(ownerCardInGroup).toBeVisible()
  await groupBox.screenshot({ path: path.join(SCREENSHOTS_DIR, '1-owner-stock-inside-group.png') })

  // ── 7. Login as user2 and open inventory ──────────────────────────────
  const page2 = await context.newPage()
  await loginAs(page2, USER2.username, USER2.password)
  await page2.getByRole('link', { name: 'Inventory' }).click()
  await expect(page2).toHaveURL('/inventory')

  // ── 8. The shared stock must be visible to user2 ──────────────────────
  await page2.waitForLoadState('networkidle')
  const sharedCard = page2.locator('[data-testid="product-card"]').filter({ hasText: stockName })
  await expect(sharedCard).toBeVisible({ timeout: 10000 })

  // Owner label should appear on the card
  await expect(sharedCard.getByText(SEED.admin.username)).toBeVisible()

  // Share button must NOT appear (user2 is not the owner)
  await expect(sharedCard.getByTitle('Share with')).not.toBeVisible()

  // ── Screenshot 2: close-up of user2's shared card (with owner label) ──
  await sharedCard.screenshot({ path: path.join(SCREENSHOTS_DIR, '2-user2-shared-card.png') })

  // ── Screenshot 3: user2's full inventory page ─────────────────────────
  await saveScreenshot(page2, '3-user2-full-inventory')

  await page2.close()

  console.log(`\nScreenshots saved to ${SCREENSHOTS_DIR}/`)
  console.log('  1-owner-inventory-stock-in-group.png  — owner view: stock inside a group')
  console.log('  2-user2-inventory-loaded.png          — recipient view: inventory loaded')
  console.log('  3-user2-sees-shared-stock.png         — recipient can see the shared stock')
  console.log('  4-shared-card-closeup.png             — close-up of shared card with owner label')
})
