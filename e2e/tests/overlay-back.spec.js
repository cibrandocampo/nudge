import { test, expect } from '@playwright/test'
import { setReachable } from './a11y/scenes.js'
import { buildFakeCameraVideo, fakeCameraArgs } from '../fakeCamera.js'
import {
  SEED,
  chooseFromMoreMenu,
  goToDashboard,
  goToHistory,
  goToInventory,
  goToSettings,
  goToStockDetail,
  loginAsUser1,
} from './helpers.js'

/**
 * Android «back» with an overlay open (UX-019, T207–T209). `page.goBack()` is
 * the same history traversal the system button and the back gesture trigger.
 * Each test asserts where the user ends up, because the failure this guards
 * against is a step too many or too few in the history.
 */

// Launch flags can only be set for the whole file (as in a11y.spec.js).
const cameraVideo = await buildFakeCameraVideo()
test.use({ launchOptions: { args: fakeCameraArgs(cameraVideo) } })

const dialog = (page) => page.getByRole('dialog')
const moreMenu = (page) => page.getByTestId('more-menu-items')

async function openChangePassword(page) {
  await goToSettings(page)
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(dialog(page)).toBeVisible()
}

/**
 * Leave one change waiting in the offline queue, so the pending panel exists.
 * The request is aborted and the app stays «offline», so nothing reaches the
 * seeded database, and the queue dies with the test's browser context.
 */
async function queueOneChange(page, context) {
  await goToDashboard(page)
  await setReachable(page, false)
  await context.route('**/api/routines/*/log/', (route) => route.abort('connectionrefused'))
  const card = page.getByTestId('routine-card').filter({ hasText: SEED.routines.waterCactus }).first()
  await card.getByRole('button', { name: 'Mark as done' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('pending-badge')).toBeVisible({ timeout: 10_000 })
}

const openPendingPanel = (page) => page.evaluate(() => window.dispatchEvent(new Event('open-pending-badge')))

test.describe('Android back with an overlay open', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsUser1(page)
    await expect(page).toHaveURL('/')
  })

  test('back closes a modal and stays on the page', async ({ page }) => {
    await openChangePassword(page)

    await page.goBack()

    await expect(dialog(page)).toHaveCount(0)
    await expect(page).toHaveURL('/settings')
  })

  test('a second back leaves the page', async ({ page }) => {
    await openChangePassword(page)
    await page.goBack()
    await expect(dialog(page)).toHaveCount(0)

    await page.goBack()

    await expect(page).toHaveURL('/')
  })

  test('stacked overlays close one back at a time', async ({ page, context }) => {
    await queueOneChange(page, context)
    await goToStockDetail(page, 'metformin')
    const url = page.url()
    await page.getByTestId('more-menu').click()
    await expect(moreMenu(page)).toBeVisible()
    await openPendingPanel(page)
    await expect(dialog(page)).toBeVisible()

    await page.goBack()
    await expect(dialog(page)).toHaveCount(0)
    await expect(moreMenu(page)).toBeVisible()

    await page.goBack()
    await expect(moreMenu(page)).toHaveCount(0)
    expect(page.url()).toBe(url)
  })

  test('closing with the ✕ leaves no phantom step for the next back', async ({ page }) => {
    await openChangePassword(page)
    await dialog(page).getByTestId('modal-close').click()
    await expect(dialog(page)).toHaveCount(0)

    await page.goBack()

    await expect(page).toHaveURL('/')
  })

  test('a confirmed delete keeps its navigation, and back does not reopen the modal', async ({ page }) => {
    const name = `Back delete ${Date.now()}`
    await goToInventory(page)
    await page.getByRole('button', { name: '+ New' }).click()
    await page.getByPlaceholder(/ibuprofen/i).fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)
    const productUrl = page.url()

    await chooseFromMoreMenu(page, 'menu-delete')
    await dialog(page).getByRole('button', { name: 'Delete stock' }).click()
    await expect(page).toHaveURL('/inventory')

    await page.goBack()

    await expect.poll(() => page.url()).toBe(productUrl)
    await expect(dialog(page)).toHaveCount(0)
    await expect(page.getByText('Stock not found.')).toBeVisible()
  })

  test('reloading with a modal open shows the page, and back then leaves it', async ({ page }) => {
    await openChangePassword(page)

    await page.reload()
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()
    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.history.state?.usr?.overlays ?? null)).toBeNull()

    await page.goBack()
    await expect(page).toHaveURL('/')
  })

  test('back closes the «More» menu without leaving the screen', async ({ page }) => {
    await goToStockDetail(page, 'metformin')
    const url = page.url()
    await page.getByTestId('more-menu').click()
    await expect(moreMenu(page)).toBeVisible()

    await page.goBack()

    await expect(moreMenu(page)).toHaveCount(0)
    expect(page.url()).toBe(url)
  })

  test('back closes the pending-changes panel', async ({ page, context }) => {
    await queueOneChange(page, context)
    await page.getByTestId('pending-badge').click()
    await expect(dialog(page)).toBeVisible()

    await page.goBack()

    await expect(dialog(page)).toHaveCount(0)
    await expect(page).toHaveURL('/')
  })

  test('back closes the date picker', async ({ page }) => {
    await goToHistory(page)
    await page.locator('button[aria-haspopup="dialog"]').first().click()
    await expect(dialog(page)).toBeVisible()

    await page.goBack()

    await expect(dialog(page)).toHaveCount(0)
    await expect(page).toHaveURL('/history')
  })

  test('with typed text, a tap outside keeps the modal and back closes it', async ({ page }) => {
    await openChangePassword(page)
    await page.getByPlaceholder('Current password').fill('half typed')

    await page.mouse.click(4, 4)
    await expect(dialog(page)).toBeVisible()
    await expect(page.getByPlaceholder('Current password')).toHaveValue('half typed')

    await page.goBack()
    await expect(dialog(page)).toHaveCount(0)
    await expect(page).toHaveURL('/settings')
  })

  test('a form’s Cancel returns to the right page after a modal was closed', async ({ page }) => {
    await goToStockDetail(page, 'metformin')
    const productUrl = page.url()
    await chooseFromMoreMenu(page, 'menu-delete')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page).toHaveURL(/\/edit$/)
    await page.getByRole('button', { name: 'Cancel' }).click()

    await expect.poll(() => page.url()).toBe(productUrl)
  })

  test('opening and closing an overlay keeps the inventory scroll', async ({ page, context }) => {
    await page.setViewportSize({ width: 412, height: 600 })
    await queueOneChange(page, context)
    await goToInventory(page)
    await page.evaluate(() => window.scrollTo(0, 300))
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300)
    await openPendingPanel(page)
    await expect(dialog(page)).toBeVisible()

    await page.goBack()

    await expect(dialog(page)).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(300)
  })

  test('back closes the scanner', async ({ page, context }) => {
    // Hold the decoder so the scanner stays on the live video instead of
    // reading the demo code and closing by itself.
    let release
    const held = new Promise((resolve) => (release = resolve))
    await context.route('**/*.wasm', async (route) => {
      await held
      await route.abort().catch(() => {})
    })
    await goToStockDetail(page, 'metformin')
    const url = page.url()
    await page.getByTestId('add-lot-scan').click()
    await expect(page.getByTestId('scan-video')).toBeVisible({ timeout: 15_000 })

    await page.goBack()

    await expect(page.getByTestId('scan-video')).toHaveCount(0)
    expect(page.url()).toBe(url)
    release()
  })
})
