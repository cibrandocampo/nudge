import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * GET /api/dashboard/ — the due + upcoming routine lists shown on the home
 * page. Returned shape: `{ due: Routine[], upcoming: Routine[] }`.
 */
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard/')
      if (!res.ok) {
        const err = new Error('Failed to fetch dashboard')
        err.status = res.status
        throw err
      }
      return res.json()
    },
  })
}
