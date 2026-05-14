/**
 * Display helpers for User-shaped objects ({ first_name?, last_name?,
 * email }). Centralises the rendering of a person's identity across
 * profile, contact lists, share chips, history cards, etc. Falls back
 * to `email` when first/last name are unset.
 */

export function fullName(user) {
  if (!user) return ''
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : user.email || ''
}

export function displayLabel(user) {
  // Kept as a separate export so existing callers stay compatible. May
  // be unified with `fullName` in a later cleanup once all consumers
  // stabilise.
  return fullName(user)
}

export function avatarInitial(user) {
  if (!user) return '?'
  return (user.first_name || user.email || '?').charAt(0).toUpperCase()
}
