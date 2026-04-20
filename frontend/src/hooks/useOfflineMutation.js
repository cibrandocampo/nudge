import { useMutation, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { api } from '../api/client'
import { OfflineError } from '../api/errors'
import { enqueue } from '../offline/queue'

/**
 * TanStack Query mutation wrapper that can:
 *
 *   1. Fall back to the offline queue when the network is unreachable
 *      (`queueable: true`, the default).
 *   2. Surface the `OfflineError` to the caller without queueing
 *      (`queueable: false`) — used by online-only mutations like settings
 *      or auth changes.
 *   3. Apply an optimistic cache update before the request flies, with a
 *      rollback that runs automatically if the server rejects with a
 *      non-offline error.
 *
 * Rollback semantics (important):
 *   - Online failure (4xx / 5xx / ConflictError / other non-network): rollback runs.
 *   - OfflineError with `queueable: true`: **rollback does NOT run.** The
 *     mutation resolves with `{ __queued: true }` and the optimistic state
 *     is kept. The sync worker (T065) invokes rollback itself if a drained
 *     entry eventually fails with a definitive non-recoverable error.
 *   - OfflineError with `queueable: false`: rollback runs — the online-only
 *     mutation is giving up and the UI should revert.
 *   - Successful 2xx: rollback does NOT run. The caller's `onSuccess` is
 *     responsible for reconciling the cache with the server response.
 *
 * Caller-provided `onMutate` / `onError` / `onSuccess` / `onSettled` are
 * chained around the wrapper's own logic. They receive the user context
 * (whatever their own `onMutate` returned) — the internal rollback handle
 * is kept private.
 *
 * Example:
 *
 *   const mutation = useOfflineMutation({
 *     request: ({ id, notes }) => ({
 *       method: 'POST',
 *       path: `/routines/${id}/log/`,
 *       body: { notes },
 *     }),
 *     resourceKey: ({ id }) => `routine:${id}`,
 *     optimistic: (qc, { id }) => {
 *       const prev = qc.getQueryData(['dashboard'])
 *       qc.setQueryData(['dashboard'], applyCompletion(prev, id))
 *       return () => qc.setQueryData(['dashboard'], prev)
 *     },
 *   })
 */
export function useOfflineMutation({
  request,
  resourceKey,
  parseResponse,
  queueable = true,
  optimistic,
  onMutate: callerOnMutate,
  onError: callerOnError,
  onSuccess: callerOnSuccess,
  onSettled: callerOnSettled,
  ...mutationOpts
}) {
  const queryClient = useQueryClient()

  return useMutation({
    // Without this, TanStack Query pauses the mutation when
    // `navigator.onLine === false` and `mutationFn` never runs — the
    // "queueable" branch that writes to IndexedDB can therefore never
    // fire on a real offline device. `'always'` lets `mutationFn`
    // execute regardless; the fetch inside will throw OfflineError and
    // our own catch block enqueues it.
    networkMode: 'always',
    ...mutationOpts,
    onMutate: async (vars) => {
      const userCtx = await callerOnMutate?.(vars)
      let rollback = null
      if (typeof optimistic === 'function') {
        rollback = optimistic(queryClient, vars) ?? null
      }
      return { userCtx, __rollback: rollback }
    },
    onError: (error, vars, ctx) => {
      const isOffline = error instanceof OfflineError
      // Offline + queueable means the error never surfaces (the wrapper
      // resolves with `{ __queued: true }` instead), so this branch only
      // fires when queueable is false. In both online-error cases we
      // revert the optimistic update.
      if (!isOffline && ctx?.__rollback) ctx.__rollback()
      if (isOffline && queueable === false && ctx?.__rollback) ctx.__rollback()
      callerOnError?.(error, vars, ctx?.userCtx)
    },
    onSuccess: (data, vars, ctx) => {
      callerOnSuccess?.(data, vars, ctx?.userCtx)
    },
    onSettled: (data, error, vars, ctx) => {
      callerOnSettled?.(data, error, vars, ctx?.userCtx)
    },
    mutationFn: async (vars) => {
      const idempotencyKey = uuidv4()
      const descriptor = request(vars, { idempotencyKey })
      const { method, path, body, ifUnmodifiedSince = null } = descriptor
      const m = method.toLowerCase()

      try {
        const res =
          m === 'get'
            ? await api.get(path, { idempotencyKey, ifUnmodifiedSince: ifUnmodifiedSince ?? undefined })
            : await api[m](path, body, {
                idempotencyKey,
                ifUnmodifiedSince: ifUnmodifiedSince ?? undefined,
              })

        if (!res.ok) {
          const errBody = await res.json().catch(() => null)
          const err = new Error(`HTTP ${res.status}`)
          err.status = res.status
          err.body = errBody
          throw err
        }

        if (parseResponse) return parseResponse(res, vars)
        if (res.status === 204) return null
        return res.json().catch(() => null)
      } catch (err) {
        if (err instanceof OfflineError) {
          if (queueable === false) throw err
          const rk = typeof resourceKey === 'function' ? resourceKey(vars) : resourceKey
          await enqueue({
            id: idempotencyKey,
            method,
            endpoint: path,
            body: body ?? null,
            resourceKey: rk ?? null,
            ifUnmodifiedSince: ifUnmodifiedSince ?? null,
            createdAt: new Date().toISOString(),
            status: 'pending',
          })
          return { __queued: true }
        }
        throw err
      }
    },
  })
}
