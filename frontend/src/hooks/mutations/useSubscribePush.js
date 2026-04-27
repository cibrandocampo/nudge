import { useOfflineMutation } from '../useOfflineMutation'

export function useSubscribePush() {
  return useOfflineMutation({
    queueable: false,
    request: ({ endpoint, keys }) => ({
      method: 'POST',
      path: '/push/subscribe/',
      body: { endpoint, keys },
    }),
  })
}
