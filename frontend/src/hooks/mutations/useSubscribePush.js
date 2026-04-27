import { useOfflineMutation } from '../useOfflineMutation'

export function useSubscribePush() {
  return useOfflineMutation({
    queueable: false,
    label: () => ({ key: 'offline.label.subscribePush', args: {} }),
    request: ({ endpoint, keys }) => ({
      method: 'POST',
      path: '/push/subscribe/',
      body: { endpoint, keys },
    }),
  })
}
