import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  appearanceOf,
  applyAppearance,
  DEFAULT_APPEARANCE,
  readStoredAppearance,
  STORAGE_KEY,
  storeAppearance,
  THEME_COLOR,
} from '../appearance'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_HTML = readFileSync(resolve(SRC, '..', 'index.html'), 'utf8')
const INDEX_CSS = readFileSync(resolve(SRC, 'index.css'), 'utf8')

const html = document.documentElement
const metaFor = (scheme) => document.querySelector(`meta[name="theme-color"][media*="${scheme}"]`)

// A storage whose every call throws, as in a private window with site data blocked.
const blockedStorage = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('SecurityError')
  },
}

beforeEach(() => {
  // The two metas exactly as index.html ships them.
  document.head.innerHTML = INDEX_HTML.match(/<meta name="theme-color"[^>]*>/g).join('')
})

afterEach(() => {
  delete html.dataset.theme
  html.style.fontSize = ''
  localStorage.clear()
})

describe('applyAppearance', () => {
  it.each([
    ['light', 'light'],
    ['dark', 'dark'],
  ])('a fixed %s theme sets data-theme and paints both theme-color metas', (theme, expected) => {
    applyAppearance({ theme, textSize: 'normal' })
    expect(html.dataset.theme).toBe(expected)
    expect(metaFor('light').getAttribute('content')).toBe(THEME_COLOR[theme])
    expect(metaFor('dark').getAttribute('content')).toBe(THEME_COLOR[theme])
  })

  it('«System» removes data-theme and gives each meta its own colour back', () => {
    applyAppearance({ theme: 'dark', textSize: 'normal' })
    applyAppearance({ theme: 'system', textSize: 'normal' })
    expect(html.hasAttribute('data-theme')).toBe(false)
    expect(metaFor('light').getAttribute('content')).toBe(THEME_COLOR.light)
    expect(metaFor('dark').getAttribute('content')).toBe(THEME_COLOR.dark)
  })

  it.each([
    ['normal', '100%'],
    ['large', '112.5%'],
    ['xlarge', '125%'],
  ])('text size %s sets the root font size to %s', (textSize, fontSize) => {
    applyAppearance({ theme: 'system', textSize })
    expect(html.style.fontSize).toBe(fontSize)
  })

  it('an unknown value falls back to the default', () => {
    applyAppearance({ theme: 'sepia', textSize: 'huge' })
    expect(html.hasAttribute('data-theme')).toBe(false)
    expect(html.style.fontSize).toBe('100%')
  })
})

describe('stored appearance', () => {
  it('round-trips through localStorage', () => {
    storeAppearance({ theme: 'dark', textSize: 'xlarge' })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ theme: 'dark', textSize: 'xlarge' })
    expect(readStoredAppearance()).toEqual({ theme: 'dark', textSize: 'xlarge' })
  })

  it('is the default when nothing was stored', () => {
    expect(readStoredAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('is the default when the stored copy is not JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{oops')
    expect(readStoredAppearance()).toEqual(DEFAULT_APPEARANCE)
  })

  it('blocked storage neither throws on read nor on write', () => {
    expect(readStoredAppearance(blockedStorage)).toEqual(DEFAULT_APPEARANCE)
    expect(() => storeAppearance({ theme: 'dark', textSize: 'large' }, blockedStorage)).not.toThrow()
  })
})

describe('appearanceOf', () => {
  it('maps the profile fields', () => {
    expect(appearanceOf({ theme: 'light', text_size: 'large' })).toEqual({ theme: 'light', textSize: 'large' })
  })

  it('is the default for a profile without them (a cache from before T144)', () => {
    expect(appearanceOf({ id: 1 })).toEqual(DEFAULT_APPEARANCE)
    expect(appearanceOf(null)).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('THEME_COLOR', () => {
  // The browser bar takes the header colour; a token change must move it too.
  it('matches --c-surface of each theme in index.css', () => {
    const light = INDEX_CSS.match(/^:root \{[\s\S]*?--c-surface: (#[0-9a-f]+);/m)[1]
    const dark = INDEX_CSS.match(/:root\[data-theme='dark'\] \{[\s\S]*?--c-surface: (#[0-9a-f]+);/)[1]
    expect(THEME_COLOR).toEqual({ light, dark })
  })

  it('matches the theme-color metas index.html ships', () => {
    expect(metaFor('light').getAttribute('content')).toBe(THEME_COLOR.light)
    expect(metaFor('dark').getAttribute('content')).toBe(THEME_COLOR.dark)
  })
})
