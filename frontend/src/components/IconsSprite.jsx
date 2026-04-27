import spriteRaw from '../assets/icons.svg?raw'

/**
 * Inline SVG sprite injected once at the app root.
 *
 * Every `<Icon>` component references symbols via fragment-only
 * `<use href="#i-name">`, which resolves against the current document.
 * Inlining avoids the per-`<use>` network fetch for `/icons.svg` that
 * some browsers issue under certain cache states (notably dev mode
 * without long-lived HTTP cache headers).
 *
 * `?raw` ships the sprite inside the JS bundle, so it is also cached
 * by the service worker as part of the precache without a separate
 * file entry.
 */
export default function IconsSprite() {
  return <div style={{ display: 'none' }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: spriteRaw }} />
}
