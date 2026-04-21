#!/usr/bin/env node
/*
 * Marketing screenshots for the "How it works" landing section.
 *
 * Outputs 3 PNGs to docs/screenshots/marketing/. The Astro site mirrors
 * that folder into site/public/screenshots/marketing/ via
 * site/scripts/copy-screenshots.mjs at `npm run dev` / `npm run build`
 * time, so references from the landing resolve automatically.
 *
 * This script does NOT seed — the caller (Makefile target
 * `screenshots-marketing`) runs `python manage.py seed_marketing` first.
 * The fixture (alex + jordan + 5 stocks + 4 routines) is documented in
 * backend/apps/core/management/commands/seed_marketing.py.
 *
 * Scenes:
 *   lifecycle-02-dashboard.png     — Dashboard (4 routines, 1 shared).
 *   lifecycle-03-stock.png         — Inventory (5 stock items).
 *   lifecycle-05-lot-selection.png — LotSelectionModal for Take Vitamin D.
 *
 * Locale is forced to 'en-US' via browser.newContext so react-i18next's
 * language-detector picks English regardless of the host / runner locale.
 */

import { chromium } from '@playwright/test'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'docs', 'screenshots', 'marketing')

const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const USER = process.env.MARKETING_USERNAME ?? 'alex'
const PASS = process.env.MARKETING_PASSWORD ?? ''

/* -- helpers ------------------------------------------------- */

async function screenshot(page, name) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ${name}.png`)
}

async function login(page, username, password) {
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder('Username').fill(username)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/')
}

/* -- main ---------------------------------------------------- */

async function main() {
  if (!PASS) {
    console.error('Set MARKETING_PASSWORD (and optionally MARKETING_USERNAME, BASE_URL).')
    process.exit(1)
  }

  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  // locale: 'en-US' forces the browser's navigator.language to English so
  // react-i18next's language-detector renders the UI in English even if
  // the host / runner locale is set to something else.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
  })
  const page = await context.newPage()

  try {
    console.log('Capturing marketing screenshots...\n')

    // 1. Log in as alex.
    await login(page, USER, PASS)

    // 2. Dashboard — 4 routines, one shared with jordan.
    await page.goto(`${BASE}/`)
    await screenshot(page, 'lifecycle-02-dashboard')

    // 3. Inventory — 5 stock items, Brita filter cartridge shared.
    await page.goto(`${BASE}/inventory`)
    await screenshot(page, 'lifecycle-03-stock')

    // 4. Lot-selection modal for "Take Vitamin D". Same selector idiom
    //    the existing screenshots.js uses for scene 10 to target a
    //    specific card's "Done" button via xpath ancestor.
    await page.goto(`${BASE}/`)
    await page.waitForLoadState('networkidle')
    const vitaminTitle = page.getByText('Take Vitamin D', { exact: true }).first()
    await vitaminTitle.waitFor({ state: 'visible', timeout: 10_000 })
    const vitaminCard = vitaminTitle.locator(
      'xpath=ancestor::*[.//button[@aria-label="Done"]][1]',
    )
    await vitaminCard.getByRole('button', { name: 'Done' }).click()
    // LotSelectionModal renders with role="dialog" aria-modal="true".
    // Wait for the dialog itself rather than a data-testid (not set on
    // this component) — stable across UI tweaks.
    const modal = page.getByRole('dialog')
    await modal.waitFor({ state: 'visible', timeout: 5_000 })
    // Small settle so the lot rows finish rendering before the capture.
    await page.waitForTimeout(300)
    await screenshot(page, 'lifecycle-05-lot-selection')

    console.log(`\nDone -> ${OUT}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
