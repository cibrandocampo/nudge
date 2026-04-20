import { useOfflineMutation } from '../useOfflineMutation'

export function useUnsubscribePush() {
  return useOfflineMutation({
    queueable: false,
    request: ({ endpoint }) => ({
      method: 'DELETE',
      path: '/push/unsubscribe/',
      body: { endpoint },
    }),
  })
}
