import { test, expect } from '@playwright/test'
import { SEED, loginAsUser1, resetSeed, goToDashboard, goToStockDetail, markRoutineDone } from './helpers.js'

/**
 * T127 — the consumption rules of T124–T126, end to end:
 *
 *   1. an expired lot is never consumed;
 *   2. inside a lot, the opened box goes first;
 *   3. a routine whose stock has one consumable lot logs without the picker;
 *   4. the picker asks the lot, never the box.
 *
 * The seed carries the shapes: Glucose monitor sensors is the mixed stock
 * (SEN-OLD expired + SEN-NEW valid, behind `Replace glucose sensor`);
 * Paracetamol's PCT-2028 is a full box plus a newer, opened one; Metformin's
 * MET-A holds three serialised boxes next to MET-B and MET-C.
 *
 * Every test mutates stock, so each starts from a fresh seed.
 */

/** The stock as the API returns it, looked up by name. */
async function fetchStock(page, name) {
  return page.evaluate(async (stockName) => {
    const token = localStorage.getItem('access_token')
    const res = await fetch('/api/stock/', { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    return (data.results ?? data).find((s) => s.name === stockName)
  }, name)
}

const quantitiesBy = (lots, key) => Object.fromEntries(lots.map((lot) => [lot[key], lot.quantity]))

const isConsumePost = (r) => /\/stock\/\d+\/consume\/$/.test(r.url()) && r.request().method() === 'POST'

test.describe('Consumption rules', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
  })

  test('an expired lot is never consumed', async ({ page }) => {
    await goToDashboard(page)
    await markRoutineDone(page, 'replaceGlucoseSensor')

    const stock = await fetchStock(page, SEED.stocks.glucoseSensors)
    expect(quantitiesBy(stock.lots, 'lot_number')).toEqual({
      [SEED.lots.GLUCOSE_SENSOR]: 1,
      [SEED.lots.GLUCOSE_SENSOR_VALID]: 1,
    })
  })

  test('the opened box goes before the full one', async ({ page }) => {
    const { PARACETAMOL_FULL_BOX: full, PARACETAMOL_OPENED_BOX: opened } = SEED.lots
    await goToStockDetail(page, 'paracetamol')
    await page.getByTestId('consume-one').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('radio')).toHaveCount(1)
    const consumed = page.waitForResponse(isConsumePost)
    await dialog.getByRole('button', { name: 'Consume 1' }).click()
    expect((await consumed).ok()).toBe(true)

    const stock = await fetchStock(page, SEED.stocks.paracetamol)
    expect(quantitiesBy(stock.lots, 'serial_number')).toEqual({
      [full.serial]: full.quantity,
      [opened.serial]: opened.quantity - 1,
    })
  })

  test('a routine with one consumable lot logs without the picker', async ({ page }) => {
    await goToDashboard(page)
    const logRequest = page.waitForRequest(
      (r) => /\/routines\/\d+\/log\/$/.test(r.url()) && r.method() === 'POST',
    )
    await markRoutineDone(page, 'replaceGlucoseSensor')

    expect((await logRequest).postDataJSON().lot_selections).toBeUndefined()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the picker asks the lot, never the box', async ({ page }) => {
    await goToStockDetail(page, 'metformin')
    const before = await fetchStock(page, SEED.stocks.metformin)
    const lotA = SEED.lots.METFORMIN_LOTS[0]
    const lotAIds = before.lots.filter((lot) => lot.lot_number === lotA).map((lot) => lot.id)

    await page.getByTestId('consume-one').click()
    const dialog = page.getByRole('dialog')
    // One row per lot — MET-A's three boxes are not offered one by one.
    await expect(dialog.getByRole('radio')).toHaveText(SEED.lots.METFORMIN_LOTS.map((n) => new RegExp(n)))

    await dialog.getByRole('radio').filter({ hasText: lotA }).click()
    const consumed = page.waitForResponse(isConsumePost)
    await dialog.getByRole('button', { name: 'Consume 1' }).click()
    const response = await consumed
    expect(response.ok()).toBe(true)
    // One confirmation and it is done: no second step asking which box.
    await expect(dialog).toBeHidden()

    const { lot_selections: selections } = response.request().postDataJSON()
    expect(selections).toHaveLength(1)
    expect(lotAIds).toContain(selections[0].lot_id)
  })
})
