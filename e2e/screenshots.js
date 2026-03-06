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
const USER2 = process.env.E2E_USER2_USERNAME ?? 'laura'
const PASS2 = process.env.E2E_USER2_PASSWORD ?? 'e2e-pass-2026'

/* -- helpers ------------------------------------------------- */

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

async function login(page, username, password) {
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder('Username').fill(username)
  await page.getByPlaceholder('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL('**/')
}

/* -- seed data ----------------------------------------------- */

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
  const groups = items(await api(page, 'GET', '/api/stock-groups/'))
  for (const g of groups) {
    await api(page, 'DELETE', `/api/stock-groups/${g.id}/`)
  }
  if (routines.length || stock.length) {
    console.log(`  Cleaned ${routines.length} routines + ${stock.length} stock items`)
  }
}

async function ensureContact(page, username) {
  const contacts = await api(page, 'GET', '/api/auth/contacts/')
  if (contacts.some((c) => c.username === username)) return
  await api(page, 'POST', '/api/auth/contacts/', { username })
}

async function seed(page) {
  await cleanup(page)
  console.log('  Seeding data...')

  // Add contact for sharing
  if (USER2 && PASS2) {
    await ensureContact(page, USER2)
  }

  // Stock groups
  const healthGroup = await api(page, 'POST', '/api/stock-groups/', { name: 'Health' })
  const homeGroup = await api(page, 'POST', '/api/stock-groups/', { name: 'Home' })
  const petGroup = await api(page, 'POST', '/api/stock-groups/', { name: 'Pets' })

  // Stock items
  const vitaminStock = await api(page, 'POST', '/api/stock/', {
    name: 'Vitamin D3 2000IU', group: healthGroup.id,
  })
  const ibuprofenStock = await api(page, 'POST', '/api/stock/', {
    name: 'Ibuprofen 600mg', group: healthGroup.id,
  })
  const eyedropsStock = await api(page, 'POST', '/api/stock/', {
    name: 'Hylo-Comod 10ml', group: healthGroup.id,
  })
  const descalingStock = await api(page, 'POST', '/api/stock/', {
    name: 'Descaling tablets', group: homeGroup.id,
  })
  const filterStock = await api(page, 'POST', '/api/stock/', {
    name: 'HVAC filters', group: homeGroup.id,
  })
  const milbemaxStock = await api(page, 'POST', '/api/stock/', {
    name: 'Milbemax tablets', group: petGroup.id,
  })

  // Lots
  await api(page, 'POST', `/api/stock/${vitaminStock.id}/lots/`, {
    quantity: 90, expiry_date: '2027-01-31', lot_number: 'VD-2027A',
  })
  await api(page, 'POST', `/api/stock/${ibuprofenStock.id}/lots/`, {
    quantity: 20, expiry_date: '2027-06-30', lot_number: 'IBU-610',
  })
  await api(page, 'POST', `/api/stock/${eyedropsStock.id}/lots/`, {
    quantity: 1, expiry_date: '2026-12-31', lot_number: 'HC-4481',
  })
  await api(page, 'POST', `/api/stock/${eyedropsStock.id}/lots/`, {
    quantity: 2, expiry_date: '2027-05-15', lot_number: 'HC-5520',
  })
  await api(page, 'POST', `/api/stock/${descalingStock.id}/lots/`, {
    quantity: 6, expiry_date: '2027-06-30',
  })
  await api(page, 'POST', `/api/stock/${filterStock.id}/lots/`, {
    quantity: 2, expiry_date: '2027-09-30', lot_number: 'HF-300',
  })
  await api(page, 'POST', `/api/stock/${milbemaxStock.id}/lots/`, {
    quantity: 1, expiry_date: '2026-11-30', lot_number: 'VET-920',
  })
  await api(page, 'POST', `/api/stock/${milbemaxStock.id}/lots/`, {
    quantity: 2, expiry_date: '2027-04-15', lot_number: 'VET-1080',
  })

  // Get contacts for sharing
  let contactId = null
  if (USER2 && PASS2) {
    const contacts = await api(page, 'GET', '/api/auth/contacts/')
    const contact = contacts.find((c) => c.username === USER2)
    if (contact) contactId = contact.id
  }

  // Routines (mix of due, upcoming, and shared)
  const vitaminD = await api(page, 'POST', '/api/routines/', {
    name: 'Take vitamin D', interval_hours: 24,
    stock: vitaminStock.id, stock_usage: 1,
  })
  const eyedrops = await api(page, 'POST', '/api/routines/', {
    name: 'Eye drops', interval_hours: 8,
    stock: eyedropsStock.id, stock_usage: 1,
    ...(contactId ? { shared_with: [contactId] } : {}),
  })
  const plants = await api(page, 'POST', '/api/routines/', {
    name: 'Water the plants', interval_hours: 72,
    ...(contactId ? { shared_with: [contactId] } : {}),
  })
  const coffee = await api(page, 'POST', '/api/routines/', {
    name: 'Clean coffee machine', interval_hours: 336,
    stock: descalingStock.id, stock_usage: 1,
  })
  await api(page, 'POST', '/api/routines/', {
    name: 'Change HVAC filter', interval_hours: 2160,
    stock: filterStock.id, stock_usage: 1,
  })
  const deworm = await api(page, 'POST', '/api/routines/', {
    name: 'Deworm Luna', interval_hours: 2160,
    stock: milbemaxStock.id, stock_usage: 1,
  })
  await api(page, 'POST', '/api/routines/', {
    name: 'Review server backups', interval_hours: 168,
  })

  // Share some stock too
  if (contactId) {
    await api(page, 'PATCH', `/api/stock/${eyedropsStock.id}/`, { shared_with: [contactId] })
    await api(page, 'PATCH', `/api/stock/${descalingStock.id}/`, { shared_with: [contactId] })
  }

  // Log some routines to create history and move them to "Upcoming"
  await api(page, 'POST', `/api/routines/${vitaminD.id}/log/`, { notes: 'After breakfast' })
  await api(page, 'POST', `/api/routines/${eyedrops.id}/log/`, {})
  await api(page, 'POST', `/api/routines/${coffee.id}/log/`, {})
  await api(page, 'POST', `/api/routines/${deworm.id}/log/`, {})

  console.log('  Seed complete')
  return { detailId: vitaminD.id, sharedRoutineId: plants.id }
}

/* -- main ---------------------------------------------------- */

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
    await login(page, USER, PASS)

    // 3. Seed data
    const { detailId } = await seed(page)

    // 4. Dashboard
    await page.goto(`${BASE}/`)
    await screenshot(page, '02-dashboard')

    // 5. Dashboard with share popover open
    const shareBtn = page.getByRole('button', { name: 'Share' }).first()
    if (await shareBtn.isVisible()) {
      await shareBtn.click()
      await page.waitForTimeout(300)
      await screenshot(page, '03-dashboard-sharing')
      // Close popover
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    }

    // 6. Routine detail
    await page.goto(`${BASE}/routines/${detailId}`)
    await screenshot(page, '04-routine-detail')

    // 7. New routine form
    await page.goto(`${BASE}/routines/new`)
    await screenshot(page, '05-new-routine')

    // 8. Inventory
    await page.goto(`${BASE}/inventory`)
    await screenshot(page, '06-inventory')

    // 9. History
    await page.goto(`${BASE}/history`)
    await screenshot(page, '07-history')

    // 10. Settings
    await page.goto(`${BASE}/settings`)
    await screenshot(page, '08-settings')

    // 11. Dashboard as second user (shows shared routines with owner label)
    if (USER2 && PASS2) {
      const page2 = await context.newPage()
      await login(page2, USER2, PASS2)
      await page2.goto(`${BASE}/`)
      await screenshot(page2, '09-shared-dashboard')
      await page2.close()
    }

    console.log(`\nDone -> ${OUT}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
