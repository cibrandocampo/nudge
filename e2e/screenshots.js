#!/usr/bin/env node
import { chromium } from '@playwright/test'
import { mkdir } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'docs', 'screenshots')

const BASE = (process.env.BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
const USER = process.env.E2E_USERNAME ?? 'admin'
const PASS = process.env.E2E_PASSWORD ?? ''

/* ── helpers ─────────────────────────────────────────── */

async function api(page, method, path, body) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem('access_token')
      const res = await fetch(path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
      }
      if (res.status === 204) return null
      return res.json()
    },
    { method, path, body },
  )
}

async function screenshot(page, name) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
  console.log(`  ${name}.png`)
}

/* ── seed data ───────────────────────────────────────── */

function items(response) {
  return Array.isArray(response) ? response : response.results ?? []
}

async function cleanup(page) {
  const routines = items(await api(page, 'GET', '/api/routines/'))
  for (const r of routines) {
    await api(page, 'DELETE', `/api/routines/${r.id}/`)
  }
  const stock = items(await api(page, 'GET', '/api/stock/'))
  for (const s of stock) {
    await api(page, 'DELETE', `/api/stock/${s.id}/`)
  }
  if (routines.length || stock.length) {
    console.log(`  Cleaned ${routines.length} routines + ${stock.length} stock items`)
  }
}

async function seed(page) {
  await cleanup(page)

  console.log('  Seeding data...')

  // Stock items
  const metforminStock = await api(page, 'POST', '/api/stock/', { name: 'Metformin 850mg' })
  const eyedropsStock = await api(page, 'POST', '/api/stock/', { name: 'Hylo-Comod 10ml' })
  const descalingStock = await api(page, 'POST', '/api/stock/', { name: 'Descaling tablets' })
  const milbemaxStock = await api(page, 'POST', '/api/stock/', { name: 'Milbemax tablets' })

  // Lots
  await api(page, 'POST', `/api/stock/${metforminStock.id}/lots/`, {
    quantity: 60, expiry_date: '2026-09-30', lot_number: 'M2026A',
  })
  await api(page, 'POST', `/api/stock/${metforminStock.id}/lots/`, {
    quantity: 30, expiry_date: '2027-03-31', lot_number: 'M2027B',
  })
  await api(page, 'POST', `/api/stock/${eyedropsStock.id}/lots/`, {
    quantity: 2, expiry_date: '2026-12-31', lot_number: 'HC-4481',
  })
  await api(page, 'POST', `/api/stock/${descalingStock.id}/lots/`, {
    quantity: 8, expiry_date: '2027-06-30',
  })
  await api(page, 'POST', `/api/stock/${milbemaxStock.id}/lots/`, {
    quantity: 1, expiry_date: '2026-11-30', lot_number: 'VET-920',
  })

  // Routines
  const metformin = await api(page, 'POST', '/api/routines/', {
    name: 'Take metformin', interval_hours: 12, stock: metforminStock.id, stock_usage: 1,
  })
  const eyedrops = await api(page, 'POST', '/api/routines/', {
    name: 'Eye drops', interval_hours: 8, stock: eyedropsStock.id, stock_usage: 1,
  })
  await api(page, 'POST', '/api/routines/', {
    name: 'Water the ferns', interval_hours: 48,
  })
  const coffee = await api(page, 'POST', '/api/routines/', {
    name: 'Clean coffee machine', interval_hours: 168, stock: descalingStock.id, stock_usage: 1,
  })
  await api(page, 'POST', '/api/routines/', {
    name: 'Deworm the cat', interval_hours: 2160, stock: milbemaxStock.id, stock_usage: 1,
  })
  await api(page, 'POST', '/api/routines/', {
    name: 'Review server backups', interval_hours: 168,
  })

  // Log some routines -> creates history + moves them to "Upcoming"
  // Unlogged ones stay in "Today" (due immediately)
  await api(page, 'POST', `/api/routines/${metformin.id}/log/`, { notes: 'After breakfast' })
  await api(page, 'POST', `/api/routines/${eyedrops.id}/log/`, {})
  await api(page, 'POST', `/api/routines/${coffee.id}/log/`, { notes: 'Used 1 tablet' })

  console.log('  Seed complete')
  return metformin.id
}

/* ── main ────────────────────────────────────────────── */

async function main() {
  if (!PASS) {
    console.error('Set E2E_PASSWORD (and optionally E2E_USERNAME, BASE_URL).')
    process.exit(1)
  }

  await mkdir(OUT, { recursive: true })

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()

  try {
    console.log('Capturing screenshots...\n')

    // 1. Login page (unauthenticated)
    await page.goto(`${BASE}/login`)
    await screenshot(page, '01-login')

    // 2. Log in
    await page.getByPlaceholder('Username').fill(USER)
    await page.getByPlaceholder('Password').fill(PASS)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL('**/')

    // 3. Seed if needed
    const detailId = await seed(page)

    // 4. Dashboard
    await page.goto(`${BASE}/`)
    await screenshot(page, '02-dashboard')

    // 5. Routine detail
    await page.goto(`${BASE}/routines/${detailId}`)
    await screenshot(page, '03-routine-detail')

    // 6. New routine form
    await page.goto(`${BASE}/routines/new`)
    await screenshot(page, '04-new-routine')

    // 7. Inventory
    await page.goto(`${BASE}/inventory`)
    await screenshot(page, '05-inventory')

    // 8. History
    await page.goto(`${BASE}/history`)
    await screenshot(page, '06-history')

    // 9. Settings
    await page.goto(`${BASE}/settings`)
    await screenshot(page, '07-settings')

    console.log(`\nDone -> ${OUT}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
