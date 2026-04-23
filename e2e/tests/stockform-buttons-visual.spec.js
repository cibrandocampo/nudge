import { expect, test } from '@playwright/test'
import { loginAsUser1 } from './helpers/session.js'

/**
 * Measures the three secondary buttons on /inventory/new to confirm they
 * render at identical dimensions. The test fails loudly with the exact
 * per-button box so the CSS can be iterated pixel-perfect.
 */
test('StockFormPage: Share with, Add batch and Cancel render the same size', async ({ page }) => {
  await loginAsUser1(page)
  await page.goto('/inventory/new')

  const shareBtn = page.getByRole('button', { name: /share with/i })
  const addBatchBtn = page.getByRole('button', { name: /add batch/i })
  const cancelBtn = page.getByRole('button', { name: /^cancel$/i })

  await expect(shareBtn).toBeVisible()
  await expect(addBatchBtn).toBeVisible()
  await expect(cancelBtn).toBeVisible()

  const [shareBox, addBox, cancelBox] = await Promise.all([
    shareBtn.boundingBox(),
    addBatchBtn.boundingBox(),
    cancelBtn.boundingBox(),
  ])

  // Also grab computed styles for diagnosis.
  const styles = async (loc) =>
    loc.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return {
        height: cs.height,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        paddingRight: cs.paddingRight,
        lineHeight: cs.lineHeight,
        fontSize: cs.fontSize,
        borderTopWidth: cs.borderTopWidth,
        borderBottomWidth: cs.borderBottomWidth,
        boxSizing: cs.boxSizing,
      }
    })
  const [shareStyles, addStyles, cancelStyles] = await Promise.all([styles(shareBtn), styles(addBatchBtn), styles(cancelBtn)])

  console.log('Share with :', JSON.stringify({ box: shareBox, styles: shareStyles }, null, 2))
  console.log('Add batch  :', JSON.stringify({ box: addBox, styles: addStyles }, null, 2))
  console.log('Cancel     :', JSON.stringify({ box: cancelBox, styles: cancelStyles }, null, 2))

  // Both dimensions must match within 0.5 px (sub-pixel rounding OK).
  expect(Math.abs(shareBox.height - cancelBox.height)).toBeLessThan(0.5)
  expect(Math.abs(addBox.height - cancelBox.height)).toBeLessThan(0.5)
  expect(Math.abs(shareBox.width - cancelBox.width)).toBeLessThan(0.5)
  expect(Math.abs(addBox.width - cancelBox.width)).toBeLessThan(0.5)

  // Horizontal alignment: the right edge of all three must match within
  // 0.5 px so the column of section-level buttons + Cancel reads as a
  // single vertical axis.
  const shareRight = shareBox.x + shareBox.width
  const addRight = addBox.x + addBox.width
  const cancelRight = cancelBox.x + cancelBox.width
  expect(Math.abs(shareRight - cancelRight)).toBeLessThan(0.5)
  expect(Math.abs(addRight - cancelRight)).toBeLessThan(0.5)

  // Computed height, padding, font-size identical across the three.
  expect(shareStyles.height).toBe(cancelStyles.height)
  expect(addStyles.height).toBe(cancelStyles.height)
  expect(shareStyles.paddingTop).toBe(cancelStyles.paddingTop)
  expect(addStyles.paddingTop).toBe(cancelStyles.paddingTop)
  expect(shareStyles.fontSize).toBe(cancelStyles.fontSize)
  expect(addStyles.fontSize).toBe(cancelStyles.fontSize)
})
