/**
 * The 42 states the UX audit measured (docs/plans/frontend-ux-audit, T133/T134)
 * plus the states later tasks added (T151: content under the bottom bar; T152:
 * the «More» menus; T153–T154: lists in «Edit» mode; T155: the notice slot),
 * as scenes the accessibility spec can reach on its own.
 *
 * A scene is `{ id, user, widths?, camera?, run({ page, context, ids }) }`:
 *   - `id`     area__state, as in the audit;
 *   - `user`   'user1' | 'user2' | 'user3' (SEED.userN) or null for signed out;
 *   - `widths` the widths it exists at (default: every width);
 *   - `camera` true when it needs the fake camera (launch flags);
 *   - `run`    drives the app to the state and returns an optional cleanup.
 *
 * Every `run` ends by asserting it reached its state: a state that was not
 * reached must fail the test, never let axe pass over the wrong screen.
 * The spec calls the cleanup in a `finally`, so a failing scene does not leak
 * offline mode, routes or queued mutations into the next one.
 */
import { expect } from '@playwright/test'
import { SEED } from '../helpers/constants.js'
import { routineCard } from '../helpers/locators.js'

/* -- helpers -------------------------------------------------------------- */

/** The dev-only reachability hooks, as the offline specs and the audit use them. */
export async function setReachable(page, value) {
  await page.evaluate((v) => {
    if (typeof window.__NUDGE_REACHABILITY_SET__ !== 'function') {
      throw new Error('reachability hooks missing (not the dev server)')
    }
    window.__NUDGE_REACHABILITY_LOCK__ = false
    window.__NUDGE_REACHABILITY_SET__(v)
    window.__NUDGE_REACHABILITY_LOCK__ = !v
  }, value)
}

async function clearOfflineQueue(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('nudge-offline')
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      }),
  )
}

/** Ids of the signed-in user's routines and stocks, looked up by seed name. */
export async function lookupIds(page) {
  const lists = await page.evaluate(async () => {
    const token = localStorage.getItem('access_token')
    const get = async (path) => {
      const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } })
      const body = await res.json()
      return Array.isArray(body) ? body : (body.results ?? [])
    }
    return { routines: await get('/api/routines/'), stocks: await get('/api/stock/') }
  })
  const byName = (list, kind) => (name) => {
    const hit = list.find((row) => row.name === name)
    if (!hit) throw new Error(`seed ${kind} "${name}" not found`)
    return hit.id
  }
  return {
    routine: byName(lists.routines, 'routine'),
    stock: byName(lists.stocks, 'stock'),
    sharedStock: lists.stocks.find((row) => row.is_owner === false)?.id ?? null,
  }
}

/** Load a route and let it settle: data requests done, entrance transitions over. */
async function go(page, path) {
  await page.goto(path)
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
}

/** Colour transitions are 150 ms; axe reads computed colours, so let them land. */
const settle = (page) => page.waitForTimeout(350)

/** Mark a routine done from Today as on touch: focus the ✓ and press Enter. */
async function markFromCard(page, routineName) {
  const card = page.getByTestId('routine-card').filter({ hasText: routineName }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Mark as done' }).focus()
  await page.keyboard.press('Enter')
}

const R = SEED.routines
const S = SEED.stocks
const ROUTINE_NAME_PLACEHOLDER = 'e.g. Change water filter'

/* -- scenes --------------------------------------------------------------- */

export const SCENES = [
  {
    id: 'login__email',
    user: null,
    run: async ({ page }) => {
      await go(page, '/login')
      await expect(page.getByPlaceholder('Email')).toBeVisible()
    },
  },
  {
    id: 'login__password',
    user: null,
    run: async ({ page }) => {
      await go(page, '/login')
      await page.getByPlaceholder('Email').fill(SEED.user1.email)
      await page.getByRole('button', { name: 'Continue' }).click()
      await expect(page.getByPlaceholder('Password')).toBeVisible()
    },
  },
  {
    id: 'login__error',
    user: null,
    run: async ({ page }) => {
      await go(page, '/login')
      await page.getByPlaceholder('Email').fill(SEED.user1.email)
      await page.getByRole('button', { name: 'Continue' }).click()
      await page.getByPlaceholder('Password').fill('wrong-password')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByText('Invalid email or password.')).toBeVisible()
    },
  },

  {
    id: 'today__main',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/')
      await expect(routineCard(page, 'takeVitaminD').first()).toBeVisible()
    },
  },
  {
    id: 'today__lot-selection',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/')
      await markFromCard(page, R.takeVitaminD)
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    id: 'today__pending-sync',
    user: 'user1',
    run: async ({ page, context }) => {
      await go(page, '/')
      await setReachable(page, false)
      const abort = (route) => route.abort('connectionrefused')
      await context.route('**/api/routines/*/log/', abort)
      await markFromCard(page, R.waterCactus)
      await expect(page.getByTestId('pending-badge')).toBeVisible({ timeout: 10_000 })
      return async () => {
        await context.unroute('**/api/routines/*/log/', abort)
        await clearOfflineQueue(page)
        await setReachable(page, true)
      }
    },
  },
  {
    id: 'today__empty',
    user: 'user3',
    run: async ({ page }) => {
      await go(page, '/')
      // user3 (Laura) has a Galician profile, applied from sign-in (T148).
      await expect(page.getByRole('heading', { name: 'Rutinas' })).toBeVisible()
      await expect(page.getByTestId('routine-card')).toHaveCount(0)
    },
  },

  {
    id: 'routine__detail',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/routines/${ids.routine(R.takeVitaminD)}`)
      await expect(page.getByRole('heading', { name: R.takeVitaminD })).toBeVisible()
    },
  },
  {
    // T152: the rare actions of a routine (history, deactivate, delete).
    id: 'routine__more-menu',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/routines/${ids.routine(R.takeVitaminD)}`)
      await page.getByTestId('more-menu').click()
      await expect(page.getByRole('menu')).toBeVisible()
      await expect(page.getByRole('menuitem')).toHaveCount(3)
    },
  },
  {
    id: 'routine__log-date-modal',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/routines/${ids.routine(R.takeVitaminD)}`)
      await page.locator('[data-testid="pick-time-due"], [data-testid="pick-time-advance"]').first().click()
      await expect(page.getByTestId('log-date-input')).toBeVisible()
    },
  },
  {
    id: 'routine__new',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/routines/new')
      await expect(page.getByPlaceholder(ROUTINE_NAME_PLACEHOLDER)).toBeVisible()
    },
  },
  {
    id: 'routine__edit-phases',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/routines/${ids.routine(R.iplHairRemoval)}/edit`)
      await expect(page.getByPlaceholder(ROUTINE_NAME_PLACEHOLDER)).toHaveValue(R.iplHairRemoval)
    },
  },
  {
    id: 'routine__share-modal',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/routines/${ids.routine(R.changeBritaFilter)}/edit`)
      await page.getByRole('button', { name: 'Share with…' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },

  {
    id: 'inventory__main',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory')
      await expect(page.getByTestId('inventory-list')).toBeVisible()
    },
  },
  {
    // T151: the bottom bar is translucent, so its inactive labels must keep
    // their contrast with a product row scrolling underneath. The spec analyses
    // every scene at scroll 0; at the phone width the inventory list already
    // runs under the bar there, and the scene asserts it does.
    id: 'nav__content-underneath',
    user: 'user1',
    widths: ['m412'],
    run: async ({ page }) => {
      await go(page, '/inventory')
      // All: Featured alone may not reach the bar.
      await page.locator('[data-testid="stock-filter-chip"][data-chip="all"]').click()
      await expect(page.getByTestId('inventory-list')).toBeVisible()
      await page.evaluate(() => window.scrollTo(0, 0))
      const underneath = await page.evaluate(() => {
        const bar = document.querySelector('nav').getBoundingClientRect()
        return [...document.querySelectorAll('[data-testid="product-card"]')].some((el) => {
          const r = el.getBoundingClientRect()
          return r.top < bar.bottom && r.bottom > bar.top
        })
      })
      expect(underneath, 'an inventory row runs under the bottom bar').toBe(true)
    },
  },
  {
    id: 'inventory__search-results',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory')
      await page.getByTestId('stock-search').fill('ibu')
      await expect(page.getByTestId('product-card').filter({ hasText: S.ibuprofen })).toBeVisible()
    },
  },
  {
    id: 'inventory__search-empty',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory')
      await page.getByTestId('stock-search').fill('zzzz')
      await expect(page.getByRole('button', { name: /clear filters/i })).toBeVisible()
    },
  },
  {
    id: 'inventory__filter-active',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory')
      const chip = page.getByTestId('stock-filter-chip').nth(1)
      await chip.click()
      await expect(chip).toHaveAttribute('data-active', 'true')
    },
  },
  {
    id: 'inventory__empty',
    user: 'user3',
    run: async ({ page }) => {
      await go(page, '/inventory')
      await expect(page.getByText('Aínda sen artigos').first()).toBeVisible()
    },
  },

  {
    id: 'product__detail',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}`)
      await page.getByTestId('medicine-toggle').click()
      await expect(page.getByTestId('regulatory-official-name')).toBeVisible()
      await expect(page.getByTestId('leaflet-sections')).toBeVisible()
    },
  },
  {
    // T152: the rare actions of a product (history, delete).
    id: 'product__more-menu',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}`)
      await page.getByTestId('more-menu').click()
      await expect(page.getByRole('menu')).toBeVisible()
      await expect(page.getByRole('menuitem')).toHaveCount(2)
    },
  },
  {
    id: 'product__no-regulatory',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.metformin)}`)
      await expect(page.getByTestId('consume-one')).toBeVisible()
    },
  },
  {
    id: 'product__lots-expanded',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.metformin)}`)
      const expander = page.getByTestId('group-expander').first()
      await expander.click()
      await expect(expander).toHaveAttribute('aria-expanded', 'true')
    },
  },
  {
    // T153: the lots in «Edit» mode, a group expanded, every row's delete on.
    id: 'product__lots-edit',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.metformin)}`)
      await page.getByTestId('edit-toggle').click()
      await page.getByTestId('group-expander').first().click()
      await expect(page.getByTestId('row-delete').first()).toBeVisible()
    },
  },
  {
    id: 'product__recipient',
    user: 'user2',
    run: async ({ page, ids }) => {
      expect(ids.sharedStock, 'user2 sees a stock shared with her').not.toBeNull()
      await go(page, `/inventory/${ids.sharedStock}`)
      await expect(page.getByTestId('owner-info')).toBeVisible()
    },
  },
  {
    id: 'product__add-lot-entry',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}`)
      await expect(page.getByTestId('add-lot-entry')).toBeVisible()
    },
  },
  {
    id: 'product__add-lot-form',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}`)
      await page.getByTestId('add-lot-manual').click()
      await page.getByTestId('more-fields').click()
      await expect(page.getByTestId('expiry-input')).toBeVisible()
    },
  },
  {
    id: 'product__scanner',
    user: 'user1',
    camera: true,
    run: async ({ page, context, ids }) => {
      // Hold the decoder download: the scanner stays open on the live video
      // instead of reading the code and closing.
      let release
      const held = new Promise((resolve) => (release = resolve))
      const hold = async (route) => {
        await held
        await route.abort().catch(() => {})
      }
      await context.route('**/*.wasm', hold)
      const cleanup = async () => {
        release()
        await context.unroute('**/*.wasm', hold)
      }
      try {
        await go(page, `/inventory/${ids.stock(S.metformin)}`)
        await page.getByTestId('add-lot-scan').click()
        await expect(page.getByTestId('scan-video')).toBeVisible({ timeout: 15_000 })
        await page.waitForFunction(
          () => {
            const video = document.querySelector('[data-testid="scan-video"]')
            return video && video.readyState >= 2 && video.videoWidth > 0
          },
          undefined,
          { timeout: 15_000 },
        )
      } catch (err) {
        await cleanup()
        throw err
      }
      return cleanup
    },
  },
  {
    id: 'product__consume-modal',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.metformin)}`)
      await page.getByTestId('consume-one').click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    id: 'product__delete-lot-confirm',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.metformin)}`)
      // Lot trashes only show in the lots' «Edit» mode (T153); the first one
      // belongs to a single-box lot (multi-box ones show the expander).
      await page.getByTestId('edit-toggle').click()
      await page.getByTestId('row-delete').first().click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },

  {
    id: 'stock-form__new',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory/new')
      await expect(page.getByRole('heading', { name: 'New product' })).toBeVisible()
    },
  },
  {
    id: 'stock-form__invalid',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory/new')
      await page.getByRole('button', { name: 'Create' }).click()
      await expect(page.getByText('Name is required.')).toBeVisible()
      await expect(page.getByPlaceholder(/ibuprofen/i)).toBeFocused()
    },
  },
  {
    id: 'stock-form__edit',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}/edit`)
      await expect(page.getByTestId('national-code-input')).toBeVisible()
    },
  },

  {
    id: 'groups__main',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory/groups')
      await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible()
    },
  },
  {
    // T154: categories in «Edit» mode — Up / Down and delete per row.
    id: 'groups__edit',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory/groups')
      await page.getByTestId('edit-toggle').click()
      await expect(page.getByTestId('move-up').first()).toBeVisible()
    },
  },

  {
    id: 'history__main',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/history')
      await expect(page.getByTestId('history-entry').first()).toBeVisible()
    },
  },
  {
    id: 'history__date-range',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/history')
      const trigger = page.locator('button[aria-haspopup="dialog"]').first()
      await trigger.click()
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    },
  },
  {
    id: 'history__notes-editor',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/history')
      await page.getByTestId('add-note').first().click()
      await page.getByTestId('note-input').fill('Taken with breakfast')
      await expect(page.getByTestId('note-input')).toHaveValue('Taken with breakfast')
    },
  },

  {
    id: 'settings__main',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/settings')
      await expect(page.getByTestId('contacts-list')).toBeVisible()
    },
  },
  {
    // T153: contacts in «Edit» mode, each row with its remove button.
    id: 'settings__contacts-edit',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/settings')
      await expect(page.getByTestId('contacts-list')).toBeVisible()
      await page.getByTestId('edit-toggle').click()
      await expect(page.getByTestId('contacts-list').getByTestId('row-delete').first()).toBeVisible()
    },
  },
  {
    id: 'settings__change-password',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/settings')
      await page.getByRole('button', { name: 'Change password' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    id: 'settings__change-password-error',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/settings')
      await page.getByRole('button', { name: 'Change password' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Current password').fill('current')
      await dialog.getByLabel('New password', { exact: true }).fill('first')
      await dialog.getByLabel('Confirm new password').fill('second')
      await dialog.locator('button[type="submit"]').click()
      await expect(dialog.getByText("Passwords don't match")).toBeVisible()
      await expect(dialog.getByLabel('Confirm new password')).toBeFocused()
    },
  },

  {
    id: 'global__offline-banner',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory')
      await setReachable(page, false)
      await expect(page.getByTestId('offline-banner')).toBeVisible()
      return () => setReachable(page, true)
    },
  },
  {
    // T155: a queued change the server refused for good — the notice slot
    // says it could not be saved. Queued offline, refused (400) on replay.
    id: 'global__sync-errors',
    user: 'user1',
    run: async ({ page, context }) => {
      await go(page, '/')
      await setReachable(page, false)
      // Queued as `today__pending-sync` does: the request fails at the network
      // (offline, as the hook simulates it, still tries it first).
      const abort = (route) => route.abort('connectionrefused')
      await context.route('**/api/routines/*/log/', abort)
      await markFromCard(page, R.waterCactus)
      await expect(page.getByTestId('pending-badge')).toBeVisible({ timeout: 10_000 })
      // Back online, the replay is refused for good (400): an `error` entry.
      await context.unroute('**/api/routines/*/log/', abort)
      const refuse = (route) =>
        route.fulfill({ status: 400, contentType: 'application/json', body: '{"detail":"Refused."}' })
      await context.route('**/api/routines/*/log/', refuse)
      // A network failure waits for the browser's `online` event to replay
      // (offline/sync.js); the reachability hook alone does not fire it.
      await setReachable(page, true)
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await expect(page.getByTestId('notice-sync-errors')).toBeVisible({ timeout: 10_000 })
      return async () => {
        await context.unroute('**/api/routines/*/log/', refuse)
        await clearOfflineQueue(page)
      }
    },
  },
  {
    id: 'global__offline-locked',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/inventory')
      await setReachable(page, false)
      // Offline, Settings in the nav only toasts; the locked placeholder is
      // reached by client-side navigation (a reload resets reachability).
      await page.evaluate(() => {
        history.pushState({}, '', '/settings')
        dispatchEvent(new PopStateEvent('popstate'))
      })
      await expect(page.getByTestId('offline-locked-placeholder')).toBeVisible()
      return () => setReachable(page, true)
    },
  },
  {
    id: 'global__toast-success',
    user: 'user1',
    run: async ({ page }) => {
      await go(page, '/history')
      await page.getByTestId('add-note').first().click()
      await page.getByTestId('note-input').fill('Accessibility check note')
      await page.getByTestId('save-note').click()
      await expect(page.getByTestId('toast-success')).toBeVisible()
    },
  },
  {
    id: 'global__toast-error',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}`)
      await setReachable(page, false)
      // Offline «Edit» is aria-disabled: Playwright refuses to click it, a
      // finger does not. force = the user's tap.
      await page.getByTestId('edit-stock').click({ force: true })
      await expect(page.getByTestId('toast-error')).toBeVisible()
      return () => setReachable(page, true)
    },
  },
  {
    id: 'global__conflict-modal',
    user: 'user1',
    run: async ({ page, context, ids }) => {
      const id = ids.routine(R.takeVitaminD)
      await go(page, `/routines/${id}/edit`)
      await page.evaluate(() => {
        window.__NUDGE_REACHABILITY_POLL_MS__ = 500
      })
      await context.setOffline(true)
      await setReachable(page, false)
      const name = page.getByPlaceholder(ROUTINE_NAME_PLACEHOLDER)
      await name.fill(`${R.takeVitaminD} (edited)`)
      await page.getByRole('button', { name: /^save/i }).click()
      const conflict = async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue()
        return route.fulfill({
          status: 412,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'conflict',
            current: { id, name: R.takeVitaminD, updated_at: new Date().toISOString() },
          }),
        })
      }
      await context.route(`**/api/routines/${id}/`, conflict)
      const cleanup = async () => {
        await context.setOffline(false)
        await page
          .getByTestId('conflict-action-discard')
          .click({ timeout: 2_000 })
          .catch(() => {})
        await context.unroute(`**/api/routines/${id}/`, conflict)
        await clearOfflineQueue(page)
        await setReachable(page, true)
      }
      try {
        await context.setOffline(false)
        await setReachable(page, true)
        await expect(page.getByTestId('conflict-modal')).toBeVisible({ timeout: 15_000 })
      } catch (err) {
        await cleanup()
        throw err
      }
      return cleanup
    },
  },
  {
    id: 'global__confirm-modal',
    user: 'user1',
    run: async ({ page, ids }) => {
      await go(page, `/inventory/${ids.stock(S.hidroferol)}`)
      // «Delete stock» from the «More» menu (T152), not a lot's trash.
      await page.getByTestId('more-menu').click()
      await page.getByTestId('menu-delete').click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    // `useInstallPrompt` only offers installing on a mobile user agent.
    id: 'global__install-banner',
    user: 'user1',
    widths: ['m412'],
    run: async ({ page }) => {
      await go(page, '/')
      await expect(page.getByTestId('notice-pending')).toBeVisible()
    },
  },
  {
    id: 'global__install-sheet',
    user: 'user1',
    widths: ['m412'],
    run: async ({ page }) => {
      await go(page, '/')
      await page.getByTestId('notice-pending-action').click()
      await page.getByTestId('pending-install').getByRole('button').click()
      await expect(page.getByTestId('install-sheet')).toBeVisible()
    },
  },
]

export { settle }
