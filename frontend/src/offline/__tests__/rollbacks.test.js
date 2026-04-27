import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __clearRollbacksForTests,
  applyRollback,
  hasRollback,
  registerRollback,
} from '../rollbacks'

describe('registerRollbackHooks side-effect importer', () => {
  it('populates the registry with all 11 hook rollback types', async () => {
    __clearRollbacksForTests()
    // Importing the module triggers each hook's `registerRollback(...)`
    // call at module load time. Without this entry point, a discard
    // would fall back to invalidate-only when the user lands on the
    // pending panel without having visited the relevant page first.
    await import('../registerRollbackHooks')
    for (const type of [
      'consumeStock',
      'logRoutine',
      'deleteRoutine',
      'updateRoutine',
      'deleteStock',
      'updateStock',
      'createStockLot',
      'updateStockLot',
      'deleteStockLot',
      'updateEntry',
      'updateConsumption',
    ]) {
      expect(hasRollback(type)).toBe(true)
    }
  })
})

describe('rollbacks registry', () => {
  afterEach(() => {
    __clearRollbacksForTests()
    vi.restoreAllMocks()
  })

  it('registerRollback + applyRollback invokes the fn with qc and args', () => {
    const fn = vi.fn()
    registerRollback('test:happy', fn)
    const qc = { invalidateQueries: vi.fn() }
    expect(applyRollback(qc, 'test:happy', { id: 7 })).toBe(true)
    expect(fn).toHaveBeenCalledWith(qc, { id: 7 })
  })

  it('applyRollback returns false for an unknown type', () => {
    expect(applyRollback({}, 'test:missing', {})).toBe(false)
  })

  it('applyRollback swallows fn errors and returns false', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    registerRollback('test:throws', () => {
      throw new Error('boom')
    })
    expect(applyRollback({}, 'test:throws', {})).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('applyRollback defaults args to an empty object when omitted', () => {
    const fn = vi.fn()
    registerRollback('test:defaults', fn)
    applyRollback({}, 'test:defaults')
    expect(fn).toHaveBeenCalledWith({}, {})
  })

  it('hasRollback reflects the registry state', () => {
    expect(hasRollback('test:hr')).toBe(false)
    registerRollback('test:hr', () => {})
    expect(hasRollback('test:hr')).toBe(true)
  })

  it('__clearRollbacksForTests empties the registry', () => {
    registerRollback('test:clear', () => {})
    expect(hasRollback('test:clear')).toBe(true)
    __clearRollbacksForTests()
    expect(hasRollback('test:clear')).toBe(false)
  })
})
