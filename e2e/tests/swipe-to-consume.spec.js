import { test, expect } from '@playwright/test'
import { SEED, goOffline, goOnline, goToInventory, loginAsUser1, resetSeed, stockCard } from './helpers.js'

/**
 * T130–T131 — swiping an inventory row consumes one unit: it stops at a third
 * of its width, springs back, and offers Undo. Real touch events through CDP:
 * a synthetic PointerEvent cannot hold the pointer capture the gesture needs.
 */
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true })

const isConsumePost = (r) => /\/stock\/\d+\/consume\/$/.test(r.url()) && r.request().method() === 'POST'
const quantity = (page, key) => stockCard(page, key).getByTestId('row-quantity')

/** Touch-drag a row `distance` px right, from its middle. Leaves it held if `release` is false. */
async function swipeRow(page, key, distance, { release = true, steps = 12, stepMs = 16 } = {}) {
  const link = stockCard(page, key).getByTestId('row-open-detail')
  await link.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const box = await link.boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const x = box.x + box.width / 3
  const y = box.y + box.height / 2
  const touch = (type, px) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y }] })
  await touch('touchStart', x)
  for (let i = 1; i <= steps; i += 1) {
    await touch('touchMove', x + (distance * i) / steps)
    await page.waitForTimeout(stepMs)
  }
  if (release) await touch('touchEnd')
  return { link, width: box.width, finish: () => touch('touchEnd') }
}

test.describe('Swipe to consume', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await goToInventory(page)
    await expect(page.getByTestId('product-card').first()).toBeVisible()
  })

  test('swiping consumes one unit of a single-lot product and offers Undo', async ({ page }) => {
    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^12\b/)
    const consumed = page.waitForResponse(isConsumePost)
    await swipeRow(page, 'orchidFertilizer', 240)
    expect((await consumed).ok()).toBe(true)

    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^11\b/)
    await expect(page.getByTestId('toast-success').getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  test('Undo gives the unit back', async ({ page }) => {
    const consumed = page.waitForResponse(isConsumePost)
    await swipeRow(page, 'orchidFertilizer', 240)
    await consumed
    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^11\b/)

    const undone = page.waitForResponse(
      (r) => /\/stock-consumptions\/\d+\/$/.test(r.url()) && r.request().method() === 'DELETE',
    )
    await page.getByTestId('toast-success').getByRole('button', { name: 'Undo' }).click()
    expect((await undone).status()).toBe(204)
    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^12\b/)
  })

  test('with several lots the swipe asks which one, then offers Undo', async ({ page }) => {
    await swipeRow(page, 'hidroferol', 240)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const consumed = page.waitForResponse(isConsumePost)
    await dialog.getByRole('button', { name: 'Consume 1', exact: true }).click()
    expect((await consumed).ok()).toBe(true)
    await expect(page.getByTestId('toast-success').getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  test('a product with nothing to consume resists and sends nothing', async ({ page }) => {
    let posts = 0
    page.on('request', (r) => {
      if (/\/stock\/\d+\/consume\/$/.test(r.url()) && r.method() === 'POST') posts += 1
    })
    const { link, finish } = await swipeRow(page, 'pumpCannulas', 240, { release: false })
    await expect(stockCard(page, 'pumpCannulas').getByTestId('row-action-layer')).toHaveAttribute(
      'data-state',
      'blocked',
    )
    await finish()
    await expect.poll(() => link.evaluate((el) => parseFloat(el.style.getPropertyValue('--drag')))).toBe(0)
    expect(posts).toBe(0)
  })

  test('the product page follows the same rule: direct, with Undo', async ({ page }) => {
    await stockCard(page, 'orchidFertilizer').getByTestId('row-open-detail').click()
    await expect(page).toHaveURL(/\/inventory\/\d+$/)
    const consumed = page.waitForResponse(isConsumePost)
    await page.getByTestId('consume-one').click()
    expect((await consumed).ok()).toBe(true)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByTestId('toast-success').getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  test('offline the swipe queues the unit and offers no Undo', async ({ page, context }) => {
    await goOffline(page, context)
    await swipeRow(page, 'orchidFertilizer', 240)
    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^11\b/)
    await expect(page.getByTestId('toast-info')).toContainText(SEED.stocks.orchidFertilizer)
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
    await goOnline(page, context)
  })

  test('the row stops at a third, and a short drag consumes nothing', async ({ page }) => {
    let posts = 0
    page.on('request', (r) => {
      if (/\/stock\/\d+\/consume\/$/.test(r.url()) && r.method() === 'POST') posts += 1
    })
    const held = await swipeRow(page, 'orchidFertilizer', 300, { release: false })
    const travel = await held.link.evaluate((el) => parseFloat(el.style.getPropertyValue('--drag')))
    expect(travel).toBeGreaterThanOrEqual(held.width / 3 - 1)
    expect(travel).toBeLessThan(held.width / 3 + 40)
    await held.finish()
    await page.waitForResponse(isConsumePost)
    posts = 0

    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^11\b/)
    await swipeRow(page, 'orchidFertilizer', 50, { stepMs: 1, steps: 3 })
    await page.waitForTimeout(400)
    expect(posts).toBe(0)
    await expect(quantity(page, 'orchidFertilizer')).toHaveText(/^11\b/)
  })
})
