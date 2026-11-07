import { test, expect } from '@playwright/test'
import { SEED, loginAsUser1, resetSeed, routineCard, swipeRoutineCard } from './helpers.js'

/**
 * T103 — Swipe to complete routines, end to end.
 *
 * The other routine specs complete through the check on the card's action
 * layer (`markRoutineDone`); this one drags the card itself. The mouse drag
 * produces the same Pointer Events a finger does, which is what the card's
 * swipe hook listens to.
 *
 * Every test resets the seed: completions move routines between sections.
 */

const LOG_URL = /\/routines\/\d+\/log\/$/

const section = (page, heading) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) })
const cardIn = (page, heading, key) =>
  section(page, heading).getByTestId('routine-card').filter({ hasText: SEED.routines[key] })
const isLogPost = (r) => LOG_URL.test(r.url()) && r.request().method() === 'POST'

// Collects every routine-log POST the page sends, to prove none was sent.
function trackLogPosts(page) {
  const posts = []
  page.on('request', (req) => {
    if (LOG_URL.test(req.url()) && req.method() === 'POST') posts.push(req.url())
  })
  return posts
}

test.describe('Routine swipe', () => {
  test.beforeEach(async ({ page, context }) => {
    await resetSeed(context)
    await loginAsUser1(page)
    await expect(page.getByTestId('offline-banner')).toBeHidden()
    await expect(cardIn(page, 'Today', 'waterCactus')).toBeVisible()
  })

  test('swiping a Today routine past the threshold completes it', async ({ page }) => {
    const logged = page.waitForResponse(isLogPost)
    await swipeRoutineCard(page, 'waterCactus', { fraction: 0.6 })
    expect((await logged).status()).toBe(201)

    await expect(cardIn(page, 'Today', 'waterCactus')).toHaveCount(0)
    await expect(cardIn(page, 'Upcoming', 'waterCactus')).toBeVisible()
    const toast = page.getByRole('status').filter({ hasText: 'Marked as done' })
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible()
  })

  test('a short swipe springs back without completing', async ({ page }) => {
    const posts = trackLogPosts(page)
    await swipeRoutineCard(page, 'waterCactus', { fraction: 0.2 })

    await expect(cardIn(page, 'Today', 'waterCactus')).toHaveAttribute('data-phase', 'rest')
    await expect(page.getByRole('status').filter({ hasText: 'Marked as done' })).toHaveCount(0)
    expect(posts).toEqual([])
  })

  test('swiping left does not complete', async ({ page }) => {
    const posts = trackLogPosts(page)
    await swipeRoutineCard(page, 'waterCactus', { fraction: -0.6 })

    await expect(cardIn(page, 'Today', 'waterCactus')).toHaveAttribute('data-phase', 'rest')
    await expect(page).toHaveURL('/')
    expect(posts).toEqual([])
  })

  test('a routine blocked by stock resists the swipe and is not completed', async ({ page }) => {
    const key = SEED.expectedStates.blocked[0]
    const posts = trackLogPosts(page)
    await expect(routineCard(page, key).getByRole('button', { name: 'Mark as done' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await swipeRoutineCard(page, key, { fraction: 1 })

    await expect(routineCard(page, key)).toHaveAttribute('data-phase', 'rest')
    await expect(routineCard(page, key).getByTestId('routine-action-layer')).toHaveAttribute('data-state', 'blocked')
    expect(posts).toEqual([])
  })

  test('Undo after a swipe puts the routine back in Today', async ({ page }) => {
    const logged = page.waitForResponse(isLogPost)
    await swipeRoutineCard(page, 'waterCactus', { fraction: 0.6 })
    await logged

    await page.getByRole('status').filter({ hasText: 'Marked as done' }).getByRole('button', { name: 'Undo' }).click()

    await expect(cardIn(page, 'Today', 'waterCactus')).toBeVisible()
    await expect(cardIn(page, 'Upcoming', 'waterCactus')).toHaveCount(0)
  })

  test('swiping an Upcoming routine completes it early and pushes its date forward', async ({ page }) => {
    const key = SEED.expectedStates.upcoming[0]
    const card = cardIn(page, 'Upcoming', key)
    const status = card.locator('[class*="status"]').first()
    const before = await status.innerText()

    // The dashboard refetch that follows the log carries the backend's
    // next_due_at, not the optimistic one. (No reload: within the cache
    // persister's throttle window a reload rehydrates the pre-completion
    // snapshot as fresh.)
    // Seeded 30 days into a 90-day cycle, so the server only moves it past
    // 80 days once the completion is recorded.
    const DAY = 24 * 3600 * 1000
    const logged = page.waitForResponse(isLogPost)
    const refetched = page.waitForResponse(async (r) => {
      if (!r.url().endsWith('/dashboard/') || r.request().method() !== 'GET') return false
      const body = await r.json()
      const routine = body.upcoming.find((rt) => rt.name === SEED.routines[key])
      return Boolean(routine) && new Date(routine.next_due_at).getTime() > Date.now() + 80 * DAY
    })
    await swipeRoutineCard(page, key, { fraction: 0.6 })
    expect((await logged).status()).toBe(201)
    await refetched
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-phase', 'rest')
    await expect(status).not.toHaveText(before)
  })

  test('a tap on the card opens the routine detail', async ({ page }) => {
    await routineCard(page, 'waterCactus').getByTestId('routine-card-link').click()
    await expect(page).toHaveURL(/\/routines\/\d+$/)
  })

  test('with a mouse the check is visible at rest and completes on click', async ({ page }) => {
    const check = cardIn(page, 'Today', 'waterCactus').getByRole('button', { name: 'Mark as done' })
    await expect(check).toBeVisible()

    const logged = page.waitForResponse(isLogPost)
    await check.click()
    expect((await logged).status()).toBe(201)
    await expect(cardIn(page, 'Upcoming', 'waterCactus')).toBeVisible()
  })
})
