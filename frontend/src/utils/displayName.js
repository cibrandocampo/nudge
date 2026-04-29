/**
 * Display helpers for User-shaped objects ({ username, first_name?,
 * last_name? }). Centralises the "First Last (username)" pattern used
 * across SettingsPage profile/contacts and shared chips.
 */

export function fullName(user) {
  if (!user) return ''
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.username || ''
}

export function displayLabel(user) {
  if (!user) return ''
  const parts = [user.first_name, user.last_name].filter(Boolean)
  if (parts.length === 0) return user.username || ''
  return `${parts.join(' ')} (${user.username})`
}

export function avatarInitial(user) {
  if (!user) return '?'
  return (user.first_name || user.username || '?').charAt(0).toUpperCase()
}
