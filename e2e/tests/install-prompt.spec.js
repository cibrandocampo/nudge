import { devices, expect, test } from '@playwright/test'
import { loginAsUser1 } from './helpers.js'

/**
 * T150 — Install prompt visibility + sheet variants.
 *
 * Headless Chromium cannot drive the native `beforeinstallprompt` flow
 * reliably (analogous to push permission gotchas — see MEMORY) so this
 * spec only covers what is deterministic from a test runner: visibility
 * gates (mobile UA, desktop UA, standalone), sheet variants by platform,
 * and the non-closable notice that leads to the pending actions in Settings.
 *
 * The native prompt path (`hasNativePrompt=true` → `triggerNativePrompt`)
 * and the post-install `appinstalled` event are validated manually on
 * real devices; see `docs/tasks/evidence/T150/T150_manual-*.md`.
 */

const FIREFOX_ANDROID_UA =
  'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0'

// Notice + sheet copy come straight from `frontend/src/i18n/en.json`. cibran
// (user1) is seeded with language='en', so the locale assertions are stable.
const NOTICE_TEXT = /\d pending actions?/

// Install is reached through the notice: Settings lists it with its risk.
async function openInstallSheet(page) {
  await page.getByTestId('notice-pending-action').click()
  await expect(page).toHaveURL(/\/settings#pending$/)
  await page.getByTestId('pending-install').getByRole('button', { name: 'Install' }).click()
}

// `devices[...]` from Playwright bundles a `defaultBrowserType` key that, if
// passed to `test.use()` inside a describe block, forces a new worker and
// fails to apply ("Cannot use({ defaultBrowserType }) in a describe group").
// Strip it so we keep just the UA / viewport / touch options that drive our
// detection helpers (`utils/installPrompt.js`).
function deviceOptions(name) {
  const { defaultBrowserType: _drop, ...rest } = devices[name]
  return rest
}

test.describe('install prompt — iPhone UA', () => {
  test.use(deviceOptions('iPhone 13'))

  test('shows the pending-actions notice above the page, with no way to close it', async ({ page }) => {
    await loginAsUser1(page)
    const notice = page.getByTestId('notice-pending')
    await expect(notice).toContainText(NOTICE_TEXT)
    await expect(notice.getByRole('button')).toHaveCount(1)
  })

  test('opens the iOS sheet variant from the pending actions', async ({ page }) => {
    await loginAsUser1(page)
    await openInstallSheet(page)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Add Nudge to your home screen')).toBeVisible()
    await expect(dialog.getByText(/Tap the Share button/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Add to Home Screen"/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Add" in the top right/)).toBeVisible()
    // PWA / lightweight clarification subtitle is rendered in every variant.
    await expect(dialog.getByText(/lightweight version of Nudge/)).toBeVisible()
  })

  test('Settings lists both actions with their risk and does not repeat the notice', async ({ page }) => {
    await loginAsUser1(page)
    await page.getByTestId('notice-pending-action').click()
    await expect(page.getByTestId('pending-install')).toContainText("On iPhone, you won't get reminders")
    // On iPhone notifications wait for the install.
    await expect(page.getByTestId('pending-push')).toContainText('Install the app first')
    await expect(page.getByTestId('notice-pending')).toHaveCount(0)
  })

  test('the notice is back on every other screen, also after a reload', async ({ page }) => {
    await loginAsUser1(page)
    await page.reload()
    await expect(page.getByTestId('notice-pending')).toBeVisible()
    await page.locator('nav a[href="/inventory"]').click()
    await expect(page.getByTestId('notice-pending')).toBeVisible()
  })
})

test.describe('install prompt — desktop UA', () => {
  test('does not offer installing on desktop', async ({ page }) => {
    await loginAsUser1(page)
    await page.goto('/settings')
    await expect(page.getByTestId('pending-install')).toHaveCount(0)
  })
})

test.describe('install prompt — standalone mode', () => {
  test.use(deviceOptions('iPhone 13'))

  test('does not offer installing when display-mode: standalone matches', async ({ page }) => {
    // Override matchMedia BEFORE any module loads so the singleton's first
    // read of `isStandalone()` returns true.
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window)
      window.matchMedia = (q) => {
        if (typeof q === 'string' && q.includes('display-mode: standalone')) {
          return {
            matches: true,
            media: q,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
          }
        }
        return orig(q)
      }
    })

    await loginAsUser1(page)
    await page.goto('/settings')
    await expect(page.getByTestId('pending-install')).toHaveCount(0)
  })
})

test.describe('install prompt — Firefox Android UA', () => {
  test.use({
    ...deviceOptions('Pixel 5'),
    userAgent: FIREFOX_ANDROID_UA,
  })

  test('opens the Firefox Android sheet variant from the pending actions', async ({ page }) => {
    await loginAsUser1(page)
    await openInstallSheet(page)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Install Nudge')).toBeVisible()
    await expect(dialog.getByText(/Open the browser menu/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Install"/)).toBeVisible()
  })
})

test.describe('install prompt — Android Chromium UA (sheet fallback)', () => {
  // Pixel 5 device descriptor ships a Chrome Android UA, so getPlatform()
  // returns 'android-chromium'. Headless Chromium does not fire a real
  // `beforeinstallprompt`, so the Install button falls back to opening the
  // sheet — useful for asserting the new android-chromium variant.
  test.use(deviceOptions('Pixel 5'))

  test('opens the Android Chromium sheet variant from the pending actions', async ({ page }) => {
    await loginAsUser1(page)
    await openInstallSheet(page)

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Install Nudge')).toBeVisible()
    await expect(dialog.getByText(/Open the browser menu/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Install app"/)).toBeVisible()
  })
})
