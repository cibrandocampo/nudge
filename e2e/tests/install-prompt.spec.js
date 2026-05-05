import { devices, expect, test } from '@playwright/test'
import { loginAsUser1 } from './helpers.js'

/**
 * T150 — Install prompt visibility + sheet variants.
 *
 * Headless Chromium cannot drive the native `beforeinstallprompt` flow
 * reliably (analogous to push permission gotchas — see MEMORY) so this
 * spec only covers what is deterministic from a test runner: visibility
 * gates (mobile UA, desktop UA, standalone), sheet variants by platform,
 * priority of the install banner over the push AlertBanner, and the
 * Settings card mirror behaviour.
 *
 * The native prompt path (`hasNativePrompt=true` → `triggerNativePrompt`)
 * and the post-install `appinstalled` event are validated manually on
 * real devices; see `docs/tasks/evidence/T150/T150_manual-*.md`.
 */

const FIREFOX_ANDROID_UA =
  'Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0'

// Banner + sheet copy come straight from `frontend/src/i18n/en.json`. cibran
// (user1) is seeded with language='en', so the locale assertions are stable.
const BANNER_TEXT = 'Install the app for a better experience'
const PUSH_ALERT = 'Notifications are off — enable them in settings.'

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

  test('renders the install banner above the page', async ({ page }) => {
    await loginAsUser1(page)
    await expect(page.getByTestId('install-banner')).toBeVisible()
    await expect(page.getByTestId('install-banner')).toContainText(BANNER_TEXT)
  })

  test('opens the iOS sheet variant on banner click', async ({ page }) => {
    await loginAsUser1(page)
    await page.getByTestId('install-banner').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Add Nudge to your home screen')).toBeVisible()
    await expect(dialog.getByText(/Tap the Share button/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Add to Home Screen"/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Add" in the top right/)).toBeVisible()
    // PWA / lightweight clarification subtitle is rendered in every variant.
    await expect(dialog.getByText(/lightweight version of Nudge/)).toBeVisible()
  })

  test('suppresses the push "Notifications are off" AlertBanner', async ({ page }) => {
    await loginAsUser1(page)
    // Install banner is visible; the AlertBanner under Layout must NOT be
    // rendered. Layout gates it on `!canInstall && !active`.
    await expect(page.getByTestId('install-banner')).toBeVisible()
    await expect(page.getByText(PUSH_ALERT)).toHaveCount(0)
  })

  test('renders the InstallCard at the bottom of /settings', async ({ page }) => {
    await loginAsUser1(page)
    await page.goto('/settings')
    await expect(page.getByTestId('install-card')).toBeVisible()
    await expect(page.getByTestId('install-card')).toContainText('Install Nudge')
  })
})

test.describe('install prompt — desktop UA', () => {
  test('hides the install banner on desktop', async ({ page }) => {
    await loginAsUser1(page)
    await expect(page.getByTestId('install-banner')).toHaveCount(0)
  })

  test('hides the InstallCard in /settings on desktop', async ({ page }) => {
    await loginAsUser1(page)
    await page.goto('/settings')
    await expect(page.getByTestId('install-card')).toHaveCount(0)
  })
})

test.describe('install prompt — standalone mode', () => {
  test.use(deviceOptions('iPhone 13'))

  test('hides the install banner when display-mode: standalone matches', async ({ page }) => {
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
    await expect(page.getByTestId('install-banner')).toHaveCount(0)
  })
})

test.describe('install prompt — Firefox Android UA', () => {
  test.use({
    ...deviceOptions('Pixel 5'),
    userAgent: FIREFOX_ANDROID_UA,
  })

  test('opens the Firefox Android sheet variant on banner click', async ({ page }) => {
    await loginAsUser1(page)
    await page.getByTestId('install-banner').click()

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
  // `beforeinstallprompt`, so the banner click falls back to opening the
  // sheet — useful for asserting the new android-chromium variant.
  test.use(deviceOptions('Pixel 5'))

  test('opens the Android Chromium sheet variant on banner click', async ({ page }) => {
    await loginAsUser1(page)
    await page.getByTestId('install-banner').click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Install Nudge')).toBeVisible()
    await expect(dialog.getByText(/Open the browser menu/)).toBeVisible()
    await expect(dialog.getByText(/Tap "Install app"/)).toBeVisible()
  })
})
