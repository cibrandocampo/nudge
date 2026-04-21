#!/usr/bin/env node
/*
 * Regenerate docs/screenshots/*.png for the README and the landing.
 *
 * Thirteen scenes captured in a single run from the `seed_demo`
 * fixture (cibran + maria, 6 stocks, 6 routines, 6 entries). Seeding
 * is the Makefile target's responsibility — this script only logs in
 * and captures.
 *
 * Env:
 *   BASE_URL              Frontend dev server (default http://localhost:5173)
 *   DEMO_USERNAME         Primary capture subject (default cibran)
 *   DEMO_USER2_USERNAME   Shared-dashboard subject (default maria)
 *   DEMO_PASSWORD         Required. Fails fast if missing.
 *
 * Scenes: login, dashboard, dashboard-sharing, routine-detail,
 * new-routine, inventory, stock-detail, history, settings,
 * shared-dashboard, offline-banner, conflict-modal, lot-selection.
 *
 * The offline-banner and conflict-modal scenes depend on the dev-only
 * reachability hooks (`__NUDGE_REACHABILITY_*`) compiled into the
 * bundle via `import.meta.env.DEV || VITE_E2E_MODE === 'true'`. Must
 * run against the dev server (or a preview build with the flag), not
 * a production bundle.
 */

import { chromium } from '@playwright/test'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'docs', 'screenshots')

const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const USER = process.env.DEMO_USERNAME ?? 'cibran'
const USER2 = process.env.DEMO_USER2_USERNAME ?? 'maria'
const PASS = process.env.DEMO_PASSWORD ?? ''

/* -- helpers ------------------------------------------------- */

async function api(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem('access_token')
      const res = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
      }
      if (res.status === 204) return null
      return res.json()
    },
    { method, path, body },
  )
}

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

function items(response) {
  return Array.isArray(response) ? response : response.results ?? []
}

/* -- main ---------------------------------------------------- */

async function main() {
  if (!PASS) {
    console.error('Set DEMO_PASSWORD (and optionally DEMO_USERNAME, DEMO_USER2_USERNAME, BASE_URL).')
    process.exit(1)
  }

  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  // locale: 'en-US' pins react-i18next's language-detector to English
  // regardless of the host / runner locale.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
  })
  const page = await context.newPage()

  try {
    console.log('Capturing screenshots...\n')

    // 1. Login page (unauthenticated).
    await page.goto(`${BASE}/login`)
    await screenshot(page, 'login')

    // 2. Log in as cibran.
    await login(page, USER, PASS)

    // 3. Dashboard.
    await page.goto(`${BASE}/`)
    await screenshot(page, 'dashboard')

    // 4. Dashboard with share popover open on the first shared routine.
    const shareBtn = page.getByRole('button', { name: 'Share' }).first()
    if (await shareBtn.isVisible()) {
      await shareBtn.click()
      await page.waitForTimeout(300)
      await screenshot(page, 'dashboard-sharing')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }

    // Fetch routines + stocks once so downstream scenes can address
    // specific rows by name rather than relying on DOM order.
    const routines = items(await api(page, 'GET', '/api/routines/'))
    const stocks = items(await api(page, 'GET', '/api/stock/'))
    const vitaminD = routines.find((r) => r.name === 'Take Vitamin D')
    const vitaminDStock = stocks.find((s) => s.name === 'Vitamin D 1000IU')
    if (!vitaminD || !vitaminDStock) {
      throw new Error('Fixture missing "Take Vitamin D" routine or "Vitamin D 1000IU" stock — is seed_demo seeded?')
    }

    // 5. Routine detail — Take Vitamin D (stock-linked, multi-lot).
    await page.goto(`${BASE}/routines/${vitaminD.id}`)
    await screenshot(page, 'routine-detail')

    // 6. New routine form.
    await page.goto(`${BASE}/routines/new`)
    await screenshot(page, 'new-routine')

    // 7. Inventory.
    await page.goto(`${BASE}/inventory`)
    await screenshot(page, 'inventory')

    // 8. Stock detail — Vitamin D (2 lots, FEFO order).
    await page.goto(`${BASE}/inventory/${vitaminDStock.id}`)
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'stock-detail')

    // 9. History.
    await page.goto(`${BASE}/history`)
    await screenshot(page, 'history')

    // 10. Settings.
    await page.goto(`${BASE}/settings`)
    await screenshot(page, 'settings')

    // 11. Shared dashboard — login as maria in a second page, see the
    //     routine cibran shared with her.
    if (USER2) {
      const page2 = await context.newPage()
      await login(page2, USER2, PASS)
      await page2.goto(`${BASE}/`)
      await screenshot(page2, 'shared-dashboard')
      await page2.close()
      // localStorage is shared across pages in a context — maria's login
      // overwrote `access_token`. Re-login cibran so downstream scenes
      // see cibran's dashboard, not maria's (she has only the one
      // shared routine).
      await login(page, USER, PASS)
    }

    // 12. Offline banner — force reachability=false, abort the
    //     mark-done call so useOfflineMutation enqueues, surface the
    //     pending badge. Target "Water the cactus" (stock-less → no
    //     lot modal → click Done fires useLogRoutine straight away).
    await page.goto(`${BASE}/`)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => {
      if (typeof window.__NUDGE_REACHABILITY_SET__ !== 'function') {
        throw new Error('__NUDGE_REACHABILITY_SET__ missing — not running in dev / VITE_E2E_MODE build')
      }
      window.__NUDGE_REACHABILITY_LOCK__ = false
      window.__NUDGE_REACHABILITY_SET__(false)
      window.__NUDGE_REACHABILITY_LOCK__ = true
    })
    const markDoneRoute = (route) => route.abort('connectionrefused')
    await context.route('**/api/routines/*/log/', markDoneRoute)
    const cactusTitle = page.getByText('Water the cactus', { exact: true }).first()
    await cactusTitle.waitFor({ state: 'visible', timeout: 10_000 })
    const cactusCard = cactusTitle.locator(
      'xpath=ancestor::*[.//button[@aria-label="Done"]][1]',
    )
    await cactusCard.getByRole('button', { name: 'Done' }).click()
    await page.waitForSelector('[data-testid="offline-banner"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="pending-badge"]', { state: 'visible' })
    await screenshot(page, 'offline-banner')
    // Cleanup: unroute, unlock, clear queue.
    await context.unroute('**/api/routines/*/log/', markDoneRoute)
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('nudge-offline')
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    )
    await page.evaluate(() => {
      window.__NUDGE_REACHABILITY_LOCK__ = false
      window.__NUDGE_REACHABILITY_SET__(true)
    })

    // 13. Conflict modal — open 412-replay flow on Take Vitamin D.
    //     The modal only opens when a 412 arrives during a queue-driven
    //     replay (online 412 throws ConflictError and skips the queue).
    //     Fresh page so scene-12 IDB/reachability leftovers don't leak.
    await page.close()
    const pageC = await context.newPage()
    await login(pageC, USER, PASS)
    await pageC.goto(`${BASE}/routines/${vitaminD.id}/edit`)
    await pageC.waitForLoadState('networkidle')
    const nameInput = pageC.getByPlaceholder('e.g. Change water filter')
    await nameInput.waitFor({ state: 'visible', timeout: 10_000 })
    // Shorten the reachability poll so sync recovery happens sub-second.
    await pageC.evaluate(() => {
      window.__NUDGE_REACHABILITY_POLL_MS__ = 500
    })
    await context.setOffline(true)
    await pageC.evaluate(() => {
      window.__NUDGE_REACHABILITY_LOCK__ = false
      window.__NUDGE_REACHABILITY_SET__(false)
      window.__NUDGE_REACHABILITY_LOCK__ = true
    })
    await nameInput.fill('Take Vitamin D (edited)')
    await pageC.getByRole('button', { name: /^save/i }).click()
    // Arm the 412 mock BEFORE coming online — the sync worker retries
    // within `__NUDGE_REACHABILITY_POLL_MS__`.
    const conflictRoute = async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      return route.fulfill({
        status: 412,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'conflict',
          current: {
            id: vitaminD.id,
            name: 'Take Vitamin D',
            updated_at: new Date().toISOString(),
          },
        }),
      })
    }
    await context.route(`**/api/routines/${vitaminD.id}/`, conflictRoute)
    await context.setOffline(false)
    await pageC.evaluate(() => {
      window.__NUDGE_REACHABILITY_LOCK__ = false
      window.__NUDGE_REACHABILITY_SET__(true)
    })
    await pageC.waitForSelector('[data-testid="conflict-modal"]', { state: 'visible' })
    await pageC.waitForTimeout(300)
    await screenshot(pageC, 'conflict-modal')
    // Cleanup.
    await pageC.getByRole('button', { name: /discard my changes/i }).click()
    await context.unroute(`**/api/routines/${vitaminD.id}/`, conflictRoute)
    await pageC.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase('nudge-offline')
          req.onsuccess = req.onerror = req.onblocked = () => resolve()
        }),
    )
    await pageC.close()

    // 14. Lot-selection modal — Take Vitamin D has 2 lots, so clicking
    //     Done opens the LotSelectionModal (role="dialog" aria-modal).
    //     Fresh page so modal state is pristine.
    const pageL = await context.newPage()
    await login(pageL, USER, PASS)
    await pageL.goto(`${BASE}/`)
    await pageL.waitForLoadState('networkidle')
    const vitDTitle = pageL.getByText('Take Vitamin D', { exact: true }).first()
    await vitDTitle.waitFor({ state: 'visible', timeout: 10_000 })
    const vitDCard = vitDTitle.locator(
      'xpath=ancestor::*[.//button[@aria-label="Done"]][1]',
    )
    await vitDCard.getByRole('button', { name: 'Done' }).click()
    const modal = pageL.getByRole('dialog')
    await modal.waitFor({ state: 'visible', timeout: 5_000 })
    await pageL.waitForTimeout(300)
    await screenshot(pageL, 'lot-selection')

    console.log(`\nDone -> ${OUT}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
