import { readdirSync, readFileSync, globSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guard against the one failure mode CSS Modules have no signal for.
 *
 * `styles.someClass` where `someClass` is not defined in the imported file
 * resolves to `undefined`. React then drops the attribute and the element
 * renders unstyled — the Vite build says nothing, ESLint says nothing, and the
 * unit tests say nothing because they assert on text and testids. Moving a
 * class between stylesheets is therefore invisible until someone looks at the
 * page.
 *
 * This checks ONE direction: referenced-but-missing. It deliberately does not
 * report classes defined but never used — that is a different question with
 * different tradeoffs (shared primitives are legitimately used from many
 * places, and some classes exist for e2e or for states jsdom cannot reach).
 * Please do not "complete" it by adding the reverse check.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// This file quotes class references in its own comments and regexes; scanning
// itself would report them.
const SELF = 'cssModuleReferences.test.js'

/**
 * Every `.js` and `.jsx` under `src`, walked by hand so the count can be
 * cross-checked.
 *
 * `.js` matters as much as `.jsx`: `utils/stockSeverity.js` imports the
 * stylesheet and returns class names from it, so a plain module can break a
 * reference exactly as silently as a component can.
 */
function walkSources(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walkSources(full))
    else if (/\.jsx?$/.test(entry.name) && entry.name !== SELF) found.push(full)
  }
  return found
}

/**
 * Blank out what must not be searched for member access: quoted strings first
 * (so a `//` inside one cannot be mistaken for a comment), then comments.
 *
 * Template literals are left intact on purpose — `` `${s.item} ${s.selected}` ``
 * is a real reference shape in this codebase, and stripping the literal would
 * hide it.
 */
function stripNoise(code) {
  return code
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
}

/**
 * Class names a stylesheet defines.
 *
 * Only selector text is read — everything between `{` and `}` is skipped — so
 * a declaration value can never be mistaken for a class. That also means
 * `composes: x from './other.module.css'` needs no special handling: the name
 * a composing rule exports is its own selector, which is already collected.
 * (There is no `composes:` in this codebase today; this note is why none is
 * needed rather than an oversight.)
 */
function definedClasses(cssPath) {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')
  const names = new Set()
  for (const [, prelude] of css.matchAll(/([^{}]*)\{/g)) {
    for (const [, name] of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) names.add(name)
  }
  return names
}

const IMPORT_RE = /import\s+(\w+)\s+from\s+['"]([^'"]*\.module\.css)['"]/g

const files = walkSources(SRC)

const violations = []
let dynamicAccesses = 0
let checkedReferences = 0

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const code = stripNoise(source)
  const shown = relative(SRC, file)

  // Import paths are string literals, so they are read from the original
  // source rather than the blanked copy.
  for (const [, binding, importPath] of source.matchAll(IMPORT_RE)) {
    const stylesheet = resolve(dirname(file), importPath)
    const defined = definedClasses(stylesheet)

    // `(?<![.\w$])` keeps `props.s.foo` from being read as a reference to `s`.
    const refs = new RegExp(String.raw`(?<![.\w$])${binding}\.([A-Za-z_$][\w$]*)`, 'g')
    for (const [, name] of code.matchAll(refs)) {
      checkedReferences += 1
      if (!defined.has(name)) {
        violations.push(`${shown} references \`${binding}.${name}\`, missing from ${relative(SRC, stylesheet)}`)
      }
    }

    // Computed access cannot be resolved statically. Counted rather than
    // ignored: a guard that hides what it cannot see looks stronger than it is.
    dynamicAccesses += [...code.matchAll(new RegExp(String.raw`(?<![.\w$])${binding}\[`, 'g'))].length
  }
}

describe('CSS module references', () => {
  it('resolves every referenced class to its stylesheet', () => {
    console.log(
      `[css-guard] ${files.length} source files scanned · ${checkedReferences} references checked · ` +
        `${dynamicAccesses} dynamic accesses skipped (not statically resolvable)`,
    )
    expect(violations).toEqual([])
  })

  // Cross-checked against `fs.globSync` so a bug in the hand-rolled walker
  // cannot quietly shrink what this guard covers.
  it('scans every .js and .jsx file under src', () => {
    const expected = globSync('**/*.{js,jsx}', { cwd: SRC }).filter((f) => !f.endsWith(SELF))
    expect(files.length).toBe(expected.length)
    expect(files.length).toBeGreaterThan(0)
  })
})
