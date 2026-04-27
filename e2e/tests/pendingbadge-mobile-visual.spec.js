import { expect, test } from '@playwright/test'
import { SEED, loginAsUser1 } from './helpers.js'
import { goOffline, expectPendingBadge } from './helpers/offline.js'

/**
 * T110 — PendingBadge panel must fit inside narrow mobile viewports.
 *
 * Regression guard for the bug where `position: absolute; right: 0` placed
 * the panel partially off-screen because the wrapper was not flush with
 * the viewport's right edge (admin + logout buttons sit between them).
 * The fix adds a `@media (max-width: 480px)` rule that switches the panel
 * to `position: fixed` with viewport-spanning `left` / `right` paddings.
 *
 * The test: open the panel on a 375 × 667 viewport, read its bounding
 * box, and assert it sits fully within [0, 375].
 */
test.describe('PendingBadge mobile responsive', () => {
  test('panel fits inside a 375px viewport', async ({ page, context }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await loginAsUser1(page)
    await page.waitForURL('/')

    // Enqueue one mutation offline so the badge mounts and the panel has
    // an item to render. `morningStretch` is always due per the seed.
    await goOffline(page, context)
    await page
      .getByTestId('routine-card')
      .filter({ hasText: SEED.routines.morningStretch })
      .getByRole('button', { name: 'Done' })
      .click()
    await expectPendingBadge(page, { count: 1 })

    // Open the panel and measure.
    await page.getByTestId('pending-badge').click()
    const panel = page.getByRole('dialog')
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    expect(box, 'panel boundingBox should be measurable').not.toBeNull()
    // Panel must sit fully inside the 375px viewport on both edges.
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(375)
    // And below the sticky header (48px) — the fix uses top: 54px.
    expect(box.y).toBeGreaterThanOrEqual(48)
  })
})
