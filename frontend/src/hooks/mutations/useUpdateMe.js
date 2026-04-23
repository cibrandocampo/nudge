import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import { ConflictError } from '../../api/errors'

// Online-only: PATCH /auth/me/ never queues offline. On 412 (optimistic
// lock mismatch) the api client throws ConflictError with the server's
// fresh user payload in `.current`; we prime the ['me'] cache with it
// and replay the PATCH once with the fresh settings_updated_at so
// consecutive settings changes don't fail after AuthContext hands us
// a stale timestamp. A second 412 propagates as-is.
export function useUpdateMe() {
  const qc = useQueryClient()

  return useMutation({
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
      try {
        return await attempt(variables)
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
      qc.setQueryData(['me'], (prev) => ({ ...(prev ?? {}), ...data }))
    },
  })
}
