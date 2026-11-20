/**
 * Theme and text size of the app (T148).
 *
 * The profile (`user.theme`, `user.text_size`) is the source of truth, but it
 * only arrives with `/api/auth/me/`. To paint the first frame correctly this
 * device keeps a copy of the last appearance it applied in localStorage, which
 * `main.jsx` applies before React renders. The production CSP forbids inline
 * scripts, so this cannot run from `index.html`.
 *
 * Text size is a percentage on `<html>`: every font size is a `--fs-*` token in
 * rem (T146), so the whole scale follows, and a percentage keeps the size the
 * user set in the browser as the base. It is an inline style set through the
 * CSSOM, which the CSP allows (only `style=""` written in markup is blocked).
 */

export const THEMES = ['system', 'light', 'dark']
export const TEXT_SIZES = ['normal', 'large', 'xlarge']

export const DEFAULT_APPEARANCE = { theme: 'system', textSize: 'normal' }

export const STORAGE_KEY = 'nudge.appearance'

export const TEXT_SIZE_SCALE = { normal: '100%', large: '112.5%', xlarge: '125%' }

// The browser bar takes the header colour, `--c-surface`, of each theme.
// `index.html` ships the two `theme-color` metas with these same values;
// `appearance.test.js` checks both against `index.css`.
export const THEME_COLOR = { light: '#ffffff', dark: '#1d2029' }

/** `value` when it is one of `allowed`, else `fallback`. */
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)

/** Keeps only known values, so a stale or hand-edited copy cannot break the page. */
export function normaliseAppearance({ theme, textSize } = {}) {
  return {
    theme: oneOf(theme, THEMES, DEFAULT_APPEARANCE.theme),
    textSize: oneOf(textSize, TEXT_SIZES, DEFAULT_APPEARANCE.textSize),
  }
}

/** The appearance of a profile (`/api/auth/me/` payload). */
export function appearanceOf(user) {
  return normaliseAppearance({ theme: user?.theme, textSize: user?.text_size })
}

/** Applies `theme` and `textSize` to `<html>` and to the `theme-color` metas. */
export function applyAppearance(appearance, doc = document) {
  const { theme, textSize } = normaliseAppearance(appearance)
  const root = doc.documentElement
  // «System» leaves the attribute off: the CSS then follows
  // `prefers-color-scheme` on its own.
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
  root.style.fontSize = TEXT_SIZE_SCALE[textSize]

  // Each meta answers one `prefers-color-scheme`; a fixed theme makes both
  // show that theme's colour, «System» gives each its own back.
  for (const scheme of ['light', 'dark']) {
    const meta = doc.querySelector(`meta[name="theme-color"][media*="${scheme}"]`)
    if (meta) meta.setAttribute('content', THEME_COLOR[theme === 'system' ? scheme : theme])
  }
}

/** The appearance last applied on this device; the default when there is none or storage is blocked. */
export function readStoredAppearance(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    return normaliseAppearance(raw ? JSON.parse(raw) : undefined)
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

/** Remembers `appearance` for the next start on this device. Blocked storage is not an error. */
export function storeAppearance(appearance, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normaliseAppearance(appearance)))
  } catch {
    // Private mode or blocked site data: the profile still applies after
    // /auth/me/ loads, only the first frame falls back to the default.
  }
}
