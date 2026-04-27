import { useOfflineMutation } from '../useOfflineMutation'

export function useUnsubscribePush() {
  return useOfflineMutation({
    queueable: false,
    label: () => ({ key: 'offline.label.unsubscribePush', args: {} }),
    request: ({ endpoint }) => ({
      method: 'DELETE',
      path: '/push/unsubscribe/',
      body: { endpoint },
    }),
  })
}
