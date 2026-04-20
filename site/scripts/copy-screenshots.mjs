#!/usr/bin/env node
// Prebuild hook: mirror ../docs/screenshots/*.png into ./public/screenshots/
// so the Astro landing can reference them via /nudge/screenshots/... at the
// built URL without shipping a duplicate copy in the repo.

import { mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', '..', 'docs', 'screenshots')
const DEST = join(__dirname, '..', 'public', 'screenshots')

mkdirSync(DEST, { recursive: true })

let copied = 0
for (const entry of readdirSync(SRC, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.png')) continue
  copyFileSync(join(SRC, entry.name), join(DEST, entry.name))
  copied += 1
}

console.log(`copy-screenshots: mirrored ${copied} PNG(s) from docs/screenshots → site/public/screenshots`)
