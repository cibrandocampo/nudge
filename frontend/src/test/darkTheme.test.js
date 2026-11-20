import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the dark theme in `index.css` (T147).
 *
 * The dark tokens are written twice: once for «System» when the device is dark
 * (`@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }`)
 * and once for an explicit «Dark» (`:root[data-theme='dark']`). CSS has no way
 * to share one declaration list between the two, so nothing but this test
 * notices when a value is changed in one and not the other — the app would
 * then look different depending on how the user reached dark mode.
 *
 * It also fails when a light colour token has no dark value, which is how a
 * new token silently ships a light colour into the dark theme.
 */

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'index.css'), 'utf8')

// Tokens that keep their light value in dark on purpose: the logo yellow (a
// fill that reads on both), the text that sits on it, and the warning ring,
// which must stay darker than that fill in both themes.
const SAME_IN_BOTH = new Set(['--c-brand', '--c-brand-text', '--c-warning', '--c-warning-ring'])

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the first `{ … }` that follows `start`, braces balanced. */
function blockAfter(start) {
  const at = CSS.indexOf(start)
  expect(at, `${start} not found in index.css`).toBeGreaterThan(-1)
  const open = CSS.indexOf('{', at + start.length - 1)
  let depth = 0
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    if (CSS[i] === '}' && --depth === 0) return CSS.slice(open + 1, i)
  }
  throw new Error(`unbalanced block after ${start}`)
}

/** `[name, value]` pairs of a declaration list, in order. */
function declarations(body) {
  return stripComments(body)
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(':')
      return [
        d.slice(0, colon).trim(),
        d
          .slice(colon + 1)
          .trim()
          .replace(/\s+/g, ' '),
      ]
    })
}

const systemDark = declarations(blockAfter(":root:not([data-theme='light'])"))
const explicitDark = declarations(blockAfter(":root[data-theme='dark']"))
const light = declarations(blockAfter(':root {'))

describe('index.css dark theme', () => {
  it('declares the same dark values for «System» and for an explicit «Dark»', () => {
    expect(explicitDark).toEqual(systemDark)
  })

  it('switches native controls to dark (color-scheme)', () => {
    expect(Object.fromEntries(light)['color-scheme']).toBe('light')
    expect(Object.fromEntries(systemDark)['color-scheme']).toBe('dark')
  })

  it('only redefines tokens that exist in the light theme', () => {
    const lightNames = new Set(light.map(([name]) => name))
    const unknown = systemDark.map(([name]) => name).filter((name) => name.startsWith('--') && !lightNames.has(name))
    expect(unknown).toEqual([])
  })

  it('gives every light colour token a dark value', () => {
    const darkNames = new Set(systemDark.map(([name]) => name))
    const missing = light
      .map(([name]) => name)
      .filter((name) => name.startsWith('--c-') && !SAME_IN_BOTH.has(name) && !darkNames.has(name))
    expect(missing).toEqual([])
  })
})
