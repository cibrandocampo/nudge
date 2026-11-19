/**
 * Accessibility gate (UX audit plan P7, docs/plans/a11y-ci.md).
 *
 * axe-core over every state the audit measured (`a11y/scenes.js`), at a phone
 * (Pixel 7, touch) and a desktop width. Any `serious` or `critical` WCAG 2.2
 * A/AA violation fails the test; `moderate` and `minor` are only attached to
 * the report (axe.json). The failure message lists rule, impact, node count
 * and the first nodes, so a red CI says what to fix without opening artifacts.
 *
 * The scenes mutate a little data (a note, a queued completion that is
 * cleared): the suite reseeds when it is done, so the specs after it start
 * from the seed as they always did.
 */
import { test, expect, devices } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildFakeCameraVideo, fakeCameraArgs } from '../fakeCamera.js'
import { SEED } from './helpers/constants.js'
import { loginAs, resetSeed } from './helpers/session.js'
import { SCENES, lookupIds, settle } from './a11y/scenes.js'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const BLOCKING = new Set(['serious', 'critical'])

// `defaultBrowserType` cannot be set per describe (it forces a new worker
// type); the project already runs Chromium.
const { defaultBrowserType: _browser, ...pixel7 } = devices['Pixel 7']
const WIDTHS = {
  m412: pixel7,
  d1280: { viewport: { width: 1280, height: 800 } },
}

// The scanner needs a camera: the demo DataMatrix as a fake capture device.
// Built once per worker; ffmpeg ships with the Playwright image. Launch flags
// can only be set for the whole file; they are harmless for every other
// scene, which never touches the camera (as in screenshots.js).
const cameraVideo = await buildFakeCameraVideo()
test.use({ launchOptions: { args: fakeCameraArgs(cameraVideo) } })

function formatViolations(violations) {
  if (violations.length === 0) return 'no serious or critical violations'
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 3)
        .map((n) => `      - ${n.target.join(' ')}\n        ${(n.failureSummary ?? '').split('\n').join('\n        ')}`)
        .join('\n')
      return `  ${v.id} (${v.impact}, ${v.nodes.length} node${v.nodes.length === 1 ? '' : 's'}): ${v.help}\n${nodes}`
    })
    .join('\n')
}

function defineSceneTest(scene, width) {
  test(scene.id, async ({ page, context }, testInfo) => {
    let ids = null
    if (scene.user) {
      const user = SEED[scene.user]
      await loginAs(page, user.email, user.password)
      ids = await lookupIds(page)
    }

    const cleanup = await scene.run({ page, context, ids })
    try {
      // Every scene is analysed from the top of the page. Playwright's clicks
      // scroll on their own, and at an arbitrary offset a control can straddle
      // the sticky header or the fixed bottom bar: axe's target-size then
      // reports whatever is half-covered at that instant, which is about the
      // scroll, not the control. Modals are fixed and stay where they are.
      await page.evaluate(() => window.scrollTo(0, 0))
      await settle(page)
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze()
      await testInfo.attach('axe.json', {
        body: JSON.stringify(results.violations, null, 2),
        contentType: 'application/json',
      })
      const blocking = results.violations.filter((v) => BLOCKING.has(v.impact))
      expect(blocking, `${scene.id} at ${width}:\n${formatViolations(blocking)}`).toEqual([])
    } finally {
      if (cleanup) await cleanup()
    }
  })
}

test.describe('a11y', () => {
  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext()
    await resetSeed(context)
    await context.close()
  })

  for (const [width, options] of Object.entries(WIDTHS)) {
    test.describe(width, () => {
      test.use(options)

      for (const scene of SCENES) {
        if (scene.widths && !scene.widths.includes(width)) continue
        if (scene.camera) {
          test.describe(() => {
            test.use({ permissions: ['camera'] })
            defineSceneTest(scene, width)
          })
        } else {
          defineSceneTest(scene, width)
        }
      }
    })
  }
})
