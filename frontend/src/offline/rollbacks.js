/**
 * Registry of inverse functions for queued mutations (T113).
 *
 * Each hook with an optimistic update calls `registerRollback(type, fn)`
 * at module load time. When the user discards a queued entry from
 * PendingBadge (or the conflict modal), `discard(id, qc)` looks up the
 * entry's `rollbackType` and invokes the matching `fn(qc, args)` to
 * revert the optimistic side effects.
 *
 * The registry is module-scoped: entries persist for the lifetime of
 * the page. To populate it, every mutation hook is imported at least
 * once before the first discard fires — see `registerRollbackHooks.js`,
 * which pre-imports all hooks at startup so the registry is dense by
 * the time PendingBadge mounts.
 */
const REGISTRY = new Map()

/**
 * Register an inverse function for a rollback type. Hooks call this at
 * module top-level so the side-effect runs as soon as the module loads.
 *
 * @param {string} type — matches the `type` returned by the hook's
 *   `rollback(vars)` factory.
 * @param {(qc: import('@tanstack/react-query').QueryClient, args: object) => void} fn
 *   The inverse — receives the QueryClient and the persisted `args`.
 *   Must not throw; if it does, the failure is logged and `discard`
 *   continues with the cache potentially stale.
 */
export function registerRollback(type, fn) {
  REGISTRY.set(type, fn)
}

/**
 * Apply a rollback by type. Returns true when the registry knew the
 * type and the inverse ran without throwing; false otherwise.
 */
export function applyRollback(qc, type, args) {
  const fn = REGISTRY.get(type)
  if (typeof fn !== 'function') return false
  try {
    fn(qc, args ?? {})
    return true
  } catch (err) {
    // Rollback failures must never crash the discard flow — log and
    // continue. The cache may stay stale but the queue entry is still
    // removed.
    console.error('[rollback] failed', type, args, err)
    return false
  }
}

export function hasRollback(type) {
  return REGISTRY.has(type)
}

/** For tests only: empty the registry between describes. */
export function __clearRollbacksForTests() {
  REGISTRY.clear()
}
