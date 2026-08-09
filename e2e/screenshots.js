#!/usr/bin/env node
/*
 * Regenerate docs/screenshots/*.png for the README and the landing.
 *
 * Fourteen scenes captured in a single run from the unified seed
 * fixture (`manage.py seed` — cibran + maria + laura, 12 stocks,
 * 10 routines, 50 entries). Seeding is the Makefile target's
 * responsibility — this script only logs in and captures.
 *
 * Env:
 *   BASE_URL              Frontend dev server (default http://localhost:5173)
 *   DEMO_USERNAME         Primary capture subject (default cibran)
 *   DEMO_USER2_USERNAME   Shared-dashboard subject (default maria)
 *   DEMO_PASSWORD         Required. Fails fast if missing.
 *
 * Scenes: login, dashboard, dashboard-sharing, routine-detail,
 * new-routine, inventory, stock-detail, history, settings,
 * shared-dashboard, offline-banner, conflict-modal, lot-selection,
 * scan-lot.
 *
 * The scan-lot scene needs a camera, which a headless container does not
 * have: it renders the demo GS1 DataMatrix, encodes it as a Y4M clip and
 * feeds it to Chromium as a fake capture device. Requires ffmpeg on PATH
 * (the Playwright base image ships one).
 *
 * The offline-banner and conflict-modal scenes depend on the dev-only
 * reachability hooks (`__NUDGE_REACHABILITY_*`) compiled into the
 * bundle via `import.meta.env.DEV || VITE_E2E_MODE === 'true'`. Must
 * run against the dev server (or a preview build with the flag), not
 * a production bundle.
 */

import { chromium } from '@playwright/test'
import { toBuffer } from 'bwip-js/node'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'docs', 'screenshots')

const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const USER = process.env.DEMO_USERNAME ?? 'cibran'
const USER2 = process.env.DEMO_USER2_USERNAME ?? 'maria'
// Login is email-based (T193+). Demo users' emails follow `<username>@nudge.test`.
const USER_EMAIL = process.env.DEMO_EMAIL ?? `${USER}@nudge.test`
const USER2_EMAIL = process.env.DEMO_USER2_EMAIL ?? `${USER2}@nudge.test`
const PASS = process.env.DEMO_PASSWORD ?? ''

/* -- fake camera --------------------------------------------- */

// The payload printed on the demo pack, byte-for-byte the shape
// `_gs1_payload` builds in `backend/apps/core/management/commands/seed.py`
// (that file is the source of truth — keep the GTIN in step with `_DEMO_GTIN`):
// AI 01 GTIN · AI 17 expiry YYMMDD · AI 10 batch, GS-terminated · AI 21 serial.
const GS = '\x1d'
const DEMO_GTIN = '09506000134376'
const DEMO_PAYLOAD = `01${DEMO_GTIN}17270930` + `10MET-A${GS}21A9F3K2M7QX`

/**
 * Render the demo DataMatrix and encode it as the Y4M clip Chromium plays
 * through `--use-file-for-fake-video-capture`, so the scanner scene has
 * something to look at in a headless container with no camera.
 *
 * The frame is deliberately modest: a box face on a neutral surface, the code
 * centred, two bars standing in for printing. Enough to read as "a code on a
 * medicine box" without pretending to be a photograph of a real product.
 *
 * Centred matters twice over — the reticle frames the middle of the viewport,
 * and the decoder only ever reads a square centre crop of the video.
 *
 * Returns the path of the generated `.y4m`, inside a container temp dir so no
 * binary ever lands in the repository.
 */
async function buildFakeCameraVideo() {
  const dir = mkdtempSync(join(tmpdir(), 'nudge-cam-'))
  const codePath = join(dir, 'datamatrix.png')
  const videoPath = join(dir, 'camera.y4m')

  writeFileSync(
    codePath,
    await toBuffer({ bcid: 'datamatrix', text: DEMO_PAYLOAD, scale: 6, padding: 8, backgroundcolor: 'FFFFFF' }),
  )

  // 4:3 like the constraints the modal asks the camera for, so the centre
  // crop the decoder takes matches what a real phone would hand it.
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0xC9C2B6:s=640x480:r=15:d=2',
    '-loop',
    '1',
    '-i',
    codePath,
    '-filter_complex',
    '[0:v]drawbox=x=95:y=45:w=450:h=390:color=0xF5F1E9:t=fill,' +
      'drawbox=x=95:y=45:w=450:h=390:color=0xACA294:t=3,' +
      'drawbox=x=140:y=372:w=170:h=7:color=0x8C8578:t=fill,' +
      'drawbox=x=140:y=392:w=110:h=7:color=0x8C8578:t=fill[bg];' +
      '[1:v]scale=215:215[dm];[bg][dm]overlay=(W-w)/2:(H-h)/2[v]',
    '-map',
    '[v]',
    '-t',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-f',
    'yuv4mpegpipe',
    videoPath,
  ])

  return videoPath
}

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

// The scanner scene does not use this helper: it holds the decoder's wasm
// request open on purpose, so `networkidle` would never arrive. It settles and
// shoots inline instead.
async function screenshot(page, name) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ${name}.png`)
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder('Email').fill(email)
  await page.getByRole('button', { name: 'Continue' }).click()
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

  // Built before launch on purpose: the fake-capture flag is a launch
  // argument, so the file has to exist by then.
  const fakeCameraVideo = await buildFakeCameraVideo()

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${fakeCameraVideo}`,
      // Grants the camera permission prompt so `getUserMedia` resolves
      // without a user gesture. Harmless for the other scenes: nothing else
      // in this script touches the camera.
      '--use-fake-ui-for-media-stream',
    ],
  })
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
    await login(page, USER_EMAIL, PASS)

    // 3. Dashboard.
    await page.goto(`${BASE}/`)
    await screenshot(page, 'dashboard')

    // Fetch routines + stocks once so downstream scenes can address
    // specific rows by name rather than relying on DOM order.
    const routines = items(await api(page, 'GET', '/api/routines/'))
    const stocks = items(await api(page, 'GET', '/api/stock/'))
    const vitaminD = routines.find((r) => r.name === 'Take Vitamin D')
    const brita = routines.find((r) => r.name === 'Change Brita filter')
    // The stock the serial story is told with: MET-A carries four scanned
    // packs, so its detail page shows the pack expander and its history shows a
    // consumed serial. Also the subject of the scanner scene.
    const metformin = stocks.find((s) => s.name === 'Metformin 850mg')
    if (!vitaminD || !brita || !metformin) {
      throw new Error(
        'Fixture missing "Take Vitamin D" routine, "Change Brita filter" routine or "Metformin 850mg" stock — is the unified seed seeded? (`manage.py seed`)',
      )
    }

    // 4. Sharing — ShareModal open on the Brita routine. The UX refresh
    //    moved sharing off the dashboard cards (now a read-only badge)
    //    and onto the routine form, so we open the modal from there.
    //    Keeping the filename `dashboard-sharing.png` to match the
    //    landing carousel (site/src/pages/index.astro).
    await page.goto(`${BASE}/routines/${brita.id}/edit`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Share with…' }).click()
    await page.getByRole('dialog').waitFor({ state: 'visible' })
    await page.waitForTimeout(300)
    await screenshot(page, 'dashboard-sharing')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // 5. Routine detail — Take Vitamin D (stock-linked, multi-lot).
    await page.goto(`${BASE}/routines/${vitaminD.id}`)
    await screenshot(page, 'routine-detail')

    // 6. New routine form.
    await page.goto(`${BASE}/routines/new`)
    await screenshot(page, 'new-routine')

    // 7. Inventory.
    await page.goto(`${BASE}/inventory`)
    await screenshot(page, 'inventory')

    // 8. Stock detail — Metformin: three lots in FEFO order, the pack expander
    //    on the serialised one, and a consumption row naming the serial that
    //    was used. Hidroferol was the previous subject and showed neither, which
    //    made this the one screen that never evidenced pack-level tracking.
    await page.goto(`${BASE}/inventory/${metformin.id}`)
    await page.waitForLoadState('networkidle')
    await screenshot(page, 'stock-detail')

    // 9. History.
    await page.goto(`${BASE}/history`)
    await screenshot(page, 'history')

    // 10. Settings.
    await page.goto(`${BASE}/settings`)
    await screenshot(page, 'settings')

    // 11. Shared dashboard — login as maria in a FRESH context so she
    //     doesn't inherit cibran's persisted React Query cache from
    //     IndexedDB (gcTime: Infinity + shared context would replay
    //     cibran's routines/stock queries under maria's session).
    if (USER2) {
      const context2 = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: 'en-US',
      })
      const page2 = await context2.newPage()
      await login(page2, USER2_EMAIL, PASS)
      await page2.goto(`${BASE}/`)
      await screenshot(page2, 'shared-dashboard')
      await context2.close()
    }

    // 12. Offline banner — force reachability=false, abort the
    //     mark-done call so useOfflineMutation enqueues, surface the
    //     pending badge. Target "Water cactus" (stock-less → no
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
    const cactusTitle = page.getByText('Water cactus', { exact: true }).first()
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
    await login(pageC, USER_EMAIL, PASS)
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
    await login(pageL, USER_EMAIL, PASS)
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

    // 15. Scanning — the scanner modal with the demo DataMatrix framed in the
    //     reticle, fed by the fake camera built above.
    //
    //     The decoder has to be kept from firing. A crisp valid code is read
    //     within a couple of frames, and a successful read closes the modal and
    //     hands the payload to the form — the viewfinder would never be on
    //     screen to photograph. So the decoder's WebAssembly binary (a
    //     same-origin Vite asset) is held open for the life of the scene: the
    //     camera still streams and the reticle still draws, but the decode loop
    //     parks inside `readBarcodes` and never comes back.
    //
    //     Holding it open rather than aborting is deliberate — an abort is
    //     swallowed as "this frame did not decode" and the loop simply retries
    //     every 150 ms, which is a lot of noise for the same result.
    let releaseWasm
    const wasmHeld = new Promise((resolve) => {
      releaseWasm = resolve
    })
    const holdWasm = async (route) => {
      await wasmHeld
      await route.abort().catch(() => {})
    }
    await context.route('**/*.wasm', holdWasm)

    const pageS = await context.newPage()
    await login(pageS, USER_EMAIL, PASS)
    await pageS.goto(`${BASE}/inventory/${metformin.id}`)
    await pageS.waitForLoadState('networkidle')
    // The add-lot form is collapsed behind "Add batch" until asked for, and the
    // scan button lives inside it — reach the scanner the way a user does.
    const addLotToggle = pageS.getByTestId('add-lot-toggle')
    await addLotToggle.waitFor({ state: 'visible', timeout: 10_000 })
    await addLotToggle.click()
    const scanButton = pageS.getByTestId('scan-lot')
    await scanButton.waitFor({ state: 'visible', timeout: 10_000 })
    await scanButton.click()

    // Both ways this scene can go wrong are silent — a decode that closed the
    // modal photographs the form behind it, and a decoder error photographs an
    // error panel. Neither throws on its own, so assert before shooting.
    const video = pageS.getByTestId('scan-video')
    await video.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {
      throw new Error(
        'Scanner scene: the viewfinder never appeared. Either the camera did not start, or the decoder ' +
          'read the code and closed the modal — check that the `**/*.wasm` route is still holding.',
      )
    })
    if ((await pageS.getByTestId('scan-error').count()) > 0) {
      throw new Error('Scanner scene: the modal is showing its error panel instead of the viewfinder.')
    }
    await pageS
      .waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="scan-video"]')
          return Boolean(el) && el.readyState >= 2 && el.videoWidth > 0 && !el.paused
        },
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => {
        throw new Error('Scanner scene: the fake camera never produced a playing frame.')
      })

    // Settle, then check again *immediately* before shooting. The checks above
    // pass in the moment the modal opens, which is not enough: if the decoder
    // ever got through it would close the modal a few hundred ms later and the
    // shot would silently capture the form behind it. Re-asserting here is what
    // turns that into a failed run instead of a wrong image.
    await pageS.waitForTimeout(400)
    if (!(await video.isVisible())) {
      throw new Error('Scanner scene: the modal closed before the capture — the decoder was not held off.')
    }
    if ((await pageS.getByTestId('scan-error').count()) > 0) {
      throw new Error('Scanner scene: the modal fell into its error state before the capture.')
    }
    await pageS.screenshot({ path: join(OUT, 'scan-lot.png') })
    console.log('  scan-lot.png')

    releaseWasm()
    await pageS.close()
    await context.unroute('**/*.wasm', holdWasm)

    console.log(`\nDone -> ${OUT}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
