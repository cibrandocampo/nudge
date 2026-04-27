/**
 * Side-effect imports: every mutation hook with a rollback factory
 * needs to be loaded before `discard(id, qc)` fires for the first
 * time, so its `registerRollback(...)` call runs and the registry is
 * populated. Without this, a user who reaches the pending panel
 * without having visited the inventory page would see the legacy
 * fallback (invalidate-only) instead of the proper inverse —
 * degrading UX silently.
 *
 * Each entry below corresponds to one hook with an `optimistic`
 * update + `rollback` factory. T113 lists `useConsumeStock`; T114
 * extends with the remaining 10 hooks.
 */
import '../hooks/mutations/useConsumeStock'

// T114 rollout
import '../hooks/mutations/useLogRoutine'
import '../hooks/mutations/useDeleteRoutine'
import '../hooks/mutations/useUpdateRoutine'
import '../hooks/mutations/useDeleteStock'
import '../hooks/mutations/useUpdateStock'
import '../hooks/mutations/useCreateStockLot'
import '../hooks/mutations/useUpdateStockLot'
import '../hooks/mutations/useDeleteStockLot'
import '../hooks/mutations/useUpdateEntry'
import '../hooks/mutations/useUpdateConsumption'
