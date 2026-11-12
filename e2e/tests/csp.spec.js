import { test as base, expect } from '@playwright/test'
import { freshSession, goToStockDetail, resetSeed, waitForServiceWorkerReady } from './helpers.js'

/**
 * T055 — the app runs under the production Content Security Policy.
 *
 * The production nginx sends a strict CSP (frontend/nginx-security-headers.conf)
 * and `vite preview` mirrors it, so this spec runs in the chromium-preview
 * project only: the dev server's HMR client needs inline scripts.
 *
 * A violation rarely fails a functional spec: a blocked inline style or
 * data: image just renders wrong. So every test here collects the page's
 * `securitypolicyviolation` events and CSP console errors, and asserts none
 * happened.
 */
const test = base.extend({
  cspViolations: [
    async ({ page }, use) => {
      const violations = []
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          console.log(
            'csp-violation ' +
              JSON.stringify({ directive: e.effectiveDirective, blocked: e.blockedURI, source: e.sourceFile }),
          )
        })
      })
      page.on('console', (msg) => {
        const text = msg.text()
        if (text.startsWith('csp-violation ')) violations.push(JSON.parse(text.slice('csp-violation '.length)))
        else if (/Content Security Policy/i.test(text)) violations.push({ console: text })
      })
      await use(violations)
    },
    { auto: true },
  ],
})

// The scanner needs a camera; Chromium's fake device stands in for one.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera'],
})

test.describe('content security policy', () => {
  test('the preview serves the production CSP', async ({ page }) => {
    // Without this, every other test here would pass vacuously.
    const res = await page.goto('/login')
    const csp = res.headers()['content-security-policy'] ?? ''
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("style-src 'self'")
    expect(csp).not.toContain('unsafe-inline')
  })

  test('the main screens render without CSP violations', async ({ page, context, cspViolations }) => {
    await freshSession(page, context, { loginAs: 'user1' })
    await waitForServiceWorkerReady(page)
    for (const path of ['/', '/inventory', '/history', '/settings']) {
      await page.goto(path)
      await page.waitForLoadState('networkidle')
    }
    await goToStockDetail(page, 'metformin')
    await page.waitForLoadState('networkidle')
    expect(cspViolations).toEqual([])
  })

  test('the leaflet renders under the CSP', async ({ page, context, cspViolations }) => {
    // The agency's HTML is the one third-party markup in the app: sanitised
    // server-side, unstyled, with its images as data: URIs. The seed carries
    // FIASP's real leaflet; its last section has the pack image and a table.
    await resetSeed(context)
    await freshSession(page, context, { loginAs: 'user1' })
    await goToStockDetail(page, 'fastInsulin')
    // The seed leaves this stock's name offer pending.
    await page.getByTestId('stock-values-keep').click()
    await page.getByRole('button', { name: 'Contenido del envase e información adicional' }).click()
    const html = page.getByTestId('leaflet-section-html')
    await expect(html.locator('img')).toHaveCount(1)
    await expect(html.locator('table').first()).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(cspViolations).toEqual([])
  })

  test('the scanner decoder compiles under the CSP', async ({ page, context, cspViolations }) => {
    await freshSession(page, context, { loginAs: 'user1' })
    await goToStockDetail(page, 'metformin')
    const wasm = page.waitForResponse((r) => r.url().endsWith('.wasm'))
    // "Automatic" opens the camera straight from the stock page.
    await page.getByTestId('add-lot-scan').click()
    await expect(page.getByTestId('scan-video')).toBeVisible()
    const wasmUrl = (await wasm).url()
    // A blocked compile does surface as the scan-error panel, but
    // asynchronously, so asserting the panel's absence could pass before it
    // appears. Compiling the same binary here fails deterministically: this
    // is the step `wasm-unsafe-eval` exists for.
    const exports = await page.evaluate(
      async (url) => WebAssembly.Module.exports(await WebAssembly.compileStreaming(fetch(url))).length,
      wasmUrl,
    )
    expect(exports).toBeGreaterThan(0)
    await expect(page.getByTestId('scan-error')).toHaveCount(0)
    expect(cspViolations).toEqual([])
  })
})
