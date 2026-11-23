import { useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ConflictError } from '../../api/errors'

const UPDATE_ME_KEY = ['me', 'update']

// Online-only: PATCH /auth/me/ never queues offline. On 412 (optimistic
// lock mismatch) the api client throws ConflictError with the server's
// fresh user payload in `.current`; we prime the ['me'] cache with it
// and replay the PATCH once with the fresh settings_updated_at so
// consecutive settings changes don't fail after AuthContext hands us
// a stale timestamp. A second 412 propagates as-is.
//
// Saves run one at a time, in the order the user made them (`scope`), so the
// last choice is always the one stored. The ['me'] cache is written only when
// the last save ends: an earlier answer would put the previous value back on
// screen while the newer one is still on its way.
export function useUpdateMe() {
  const qc = useQueryClient()
  const lastSaved = useRef(null)

  return useMutation({
    mutationKey: UPDATE_ME_KEY,
    scope: { id: 'update-me' },
    networkMode: 'always',
    mutationFn: async (variables) => {
      const attempt = async ({ patch, updatedAt }) => {
        const res = await api.patch('/auth/me/', patch, { ifUnmodifiedSince: updatedAt })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          const err = new Error(`PATCH /auth/me/ failed (${res.status})`)
          err.status = res.status
          err.body = body
          throw err
        }
        return res.json()
      }
      const updatedAt = lastSaved.current?.settings_updated_at ?? variables.updatedAt
      try {
        return await attempt({ patch: variables.patch, updatedAt })
      } catch (err) {
        if (err instanceof ConflictError && err.current) {
          qc.setQueryData(['me'], err.current)
          return await attempt({
            patch: variables.patch,
            updatedAt: err.current.settings_updated_at ?? null,
          })
        }
        throw err
      }
    },
    onSuccess: (data) => {
      lastSaved.current = data
    },
    onSettled: () => {
      // This save still counts as running here, so 1 means nothing is queued.
      if (qc.isMutating({ mutationKey: UPDATE_ME_KEY }) > 1) return
      const data = lastSaved.current
      lastSaved.current = null
      if (data) qc.setQueryData(['me'], (prev) => ({ ...(prev ?? {}), ...data }))
    },
  })
}
