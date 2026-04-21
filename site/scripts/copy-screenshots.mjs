#!/usr/bin/env node
// Prebuild hook: mirror ../docs/screenshots/**/*.png into ./public/screenshots/
// preserving the subfolder structure. Lets the Astro landing reference the
// PNGs via /nudge/screenshots/<file> or /nudge/screenshots/<dir>/<file>
// without shipping a duplicate source-of-truth copy in the repo.

import { mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', '..', 'docs', 'screenshots')
const DEST = join(__dirname, '..', 'public', 'screenshots')

function mirror(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true })
  let copied = 0
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = join(srcDir, entry.name)
    const destPath = join(destDir, entry.name)
    if (entry.isDirectory()) {
      copied += mirror(srcPath, destPath)
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue
    copyFileSync(srcPath, destPath)
    copied += 1
  }
  return copied
}

const copied = mirror(SRC, DEST)
console.log(`copy-screenshots: mirrored ${copied} PNG(s) from docs/screenshots → site/public/screenshots`)
