/**
 * Smoke test: verifies every helper documented in T074 is exported.
 * Does NOT execute the helpers — behavioural coverage belongs to the
 * consuming specs (T035–T041, T069–T071). This test catches accidental
 * removals / renames that would break downstream specs with confusing
 * import errors.
 */

import { test, expect } from '@playwright/test'
import * as H from './helpers.js'

const FUNCTION_EXPORTS = [
  // Session
  'login',
  'loginAs',
  'loginAsAdmin',
  'loginAsUser1',
  'loginAsUser2',
  'loginAsUser3',
  'freshSession',
  'logout',
  'resetSeed',
  'ensureContact',
  // Navigation
  'goToDashboard',
  'goToInventory',
  'goToHistory',
  'goToSettings',
  'goToRoutineDetail',
  'goToStockDetail',
  'getCurrentResourceId',
  // Locators
  'routineCard',
  'stockCard',
  'historyEntry',
  // Routine actions
  'markRoutineDone',
  'swipeRoutineCard',
  'createRoutine',
  'renameRoutine',
  'deleteRoutine',
  'shareRoutineWith',
  'unshareRoutineFrom',
  // Stock actions
  'createStock',
  'deleteStock',
  'addLot',
  'deleteLot',
  'consumeStock',
  'shareStockWith',
  // Settings actions
  'changeTimezone',
  'changeLanguage',
  'addContact',
  'removeContact',
  'enablePush',
  'disablePush',
  'sendTestNotification',
  // History actions
  'editEntryNote',
  'filterHistory',
  // Assertions
  'expectRoutineState',
  'expectLotCount',
  'expectStockQuantity',
  'expectHistoryEntry',
  'expectInContactList',
  'expectNotInContactList',
  'expectLanguage',
  'expectToast',
  'waitForToast',
  // Utilities
  'uniqueName',
  'readNumericValue',
  'formatExpiryDate',
  // Offline (T068)
  'goOffline',
  'goOnline',
  'waitForServiceWorkerReady',
  'expectOfflineBanner',
  'expectPendingBadge',
  'waitForSyncDrain',
  'mockApiRoute',
  'openConflictOnRoutineRename',
]

test.describe('helpers smoke', () => {
  test('SEED exports the full fixture shape', () => {
    expect(H.SEED).toBeDefined()
    expect(H.SEED.admin?.username).toBeTruthy()
    expect(Object.keys(H.SEED.routines ?? {}).length).toBe(10)
    expect(Object.keys(H.SEED.stocks ?? {}).length).toBe(12)
    for (const key of H.SEED.pinnedForUser1 ?? []) {
      expect(H.SEED.stocks, `pinnedForUser1 key "${key}" must be a SEED.stocks key`).toHaveProperty(key)
    }
    expect(H.SEED.pinnedForUser1?.length).toBeLessThan(H.SEED.maxPinnedItems)
    expect(H.SEED.expectedStates?.blocked).toContain('changePumpCannula')
  })

  test('CREDS is exported (backward compat)', () => {
    expect(H.CREDS).toBe(H.SEED.admin)
  })

  test('every documented helper is a function', () => {
    for (const name of FUNCTION_EXPORTS) {
      expect(typeof H[name], `${name} must be an exported function`).toBe('function')
    }
  })

  test('sync utilities return expected shapes', () => {
    expect(H.uniqueName('x')).toMatch(/^x-\d+$/)
    expect(H.formatExpiryDate(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(H.formatExpiryDate(7)).not.toBe(H.formatExpiryDate(0))
  })
})
