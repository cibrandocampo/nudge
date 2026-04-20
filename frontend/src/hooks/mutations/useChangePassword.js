import { useOfflineMutation } from '../useOfflineMutation'

export function useChangePassword() {
  return useOfflineMutation({
    queueable: false,
    request: ({ oldPassword, newPassword }) => ({
      method: 'POST',
      path: '/auth/change-password/',
      body: { old_password: oldPassword, new_password: newPassword },
    }),
  })
}
