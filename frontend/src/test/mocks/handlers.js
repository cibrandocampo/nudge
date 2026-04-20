import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost/api'

/**
 * Build an MSW handler that returns 412 Precondition Failed for a given
 * endpoint so tests can assert the ConflictError path end-to-end.
 *
 * @param {string} method  'get' | 'post' | 'patch' | 'delete'
 * @param {string} path    Path relative to BASE (e.g. `/routines/5/`)
 * @param {object} [current] The payload the backend would echo in `current`
 */
export function mockConflict(method, path, current = {}) {
  return http[method.toLowerCase()](`${BASE}${path}`, () =>
    HttpResponse.json({ error: 'conflict', current }, { status: 412 }),
  )
}

/**
 * Build an MSW handler that simulates a network failure (fetch rejection)
 * so tests can assert the OfflineError path.
 */
export function mockNetworkError(method, path) {
  return http[method.toLowerCase()](`${BASE}${path}`, () => HttpResponse.error())
}

export const mockUser = {
  id: 1,
  username: 'testuser',
  is_staff: false,
  timezone: 'Europe/Madrid',
  language: 'en',
  daily_notification_time: '08:00:00',
  settings_updated_at: '2026-03-01T00:00:00Z',
}

export const mockRoutine = {
  id: 1,
  name: 'Take vitamins',
  description: 'Daily vitamins',
  interval_hours: 24,
  is_active: true,
  is_due: true,
  is_overdue: true,
  hours_until_due: -2,
  next_due_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  created_at: '2025-01-15T10:00:00Z',
  updated_at: '2025-01-15T10:00:00Z',
  stock_name: null,
  stock_quantity: null,
  stock_usage: 1,
  stock: null,
  shared_with: [],
  shared_with_details: [],
  is_owner: true,
  owner_username: 'testuser',
}

export const handlers = [
  http.get(`${BASE}/auth/me/`, () => HttpResponse.json(mockUser)),

  http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [], upcoming: [] })),

  http.get(`${BASE}/routines/`, () => HttpResponse.json([])),

  http.get(`${BASE}/routines/:id/`, () => HttpResponse.json(mockRoutine)),

  http.get(`${BASE}/routines/:id/entries/`, () => HttpResponse.json([])),

  http.get(`${BASE}/routines/:id/lots-for-selection/`, () =>
    HttpResponse.json([
      { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 2 },
      { lot_id: 2, lot_number: null, expiry_date: null, quantity: 1 },
    ]),
  ),

  http.post(`${BASE}/routines/:id/log/`, () => HttpResponse.json({ id: 1 }, { status: 201 })),

  http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: [], next: null })),

  http.get(`${BASE}/stock/`, () => HttpResponse.json([])),

  http.get(`${BASE}/stock/:id/`, () =>
    HttpResponse.json({
      id: 1,
      name: 'Filters',
      quantity: 5,
      group: null,
      group_name: null,
      lots: [],
      expiring_lots: [],
      has_expiring_lots: false,
      shared_with: [],
      shared_with_details: [],
      is_owner: true,
      owner_username: 'testuser',
    }),
  ),

  http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [], next: null })),

  http.patch(`${BASE}/stock-consumptions/:id/`, async ({ request, params }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      stock: 1,
      stock_name: 'Filters',
      quantity: 1,
      consumed_lots: [],
      notes: body.notes ?? '',
      created_at: '2026-03-01T10:00:00Z',
    })
  }),

  http.patch(`${BASE}/entries/:id/`, async ({ request, params }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      routine: 1,
      routine_name: 'Take vitamins',
      created_at: '2026-03-01T09:00:00Z',
      notes: body.notes ?? '',
      consumed_lots: [],
    })
  }),

  http.get(`${BASE}/stock-groups/`, () => HttpResponse.json({ results: [] })),

  http.post(`${BASE}/stock-groups/`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json(
      { id: 99, name: body.name, display_order: body.display_order ?? 0, created_at: '2026-01-01T00:00:00Z' },
      { status: 201 },
    )
  }),

  http.patch(`${BASE}/stock-groups/:id/`, async ({ request, params }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      name: 'Group',
      display_order: 0,
      created_at: '2026-01-01T00:00:00Z',
      ...body,
    })
  }),

  http.delete(`${BASE}/stock-groups/:id/`, () => new HttpResponse(null, { status: 204 })),

  http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([])),

  http.post(`${BASE}/auth/contacts/`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ id: 50, username: body.username }, { status: 201 })
  }),

  http.delete(`${BASE}/auth/contacts/:id/`, () => new HttpResponse(null, { status: 204 })),

  http.get(`${BASE}/auth/contacts/search/`, ({ request }) => {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') || ''
    if (!q) return HttpResponse.json([])
    return HttpResponse.json([{ id: 50, username: 'bob' }])
  }),

  http.post(`${BASE}/auth/token/`, () => HttpResponse.json({ access: 'fake-access', refresh: 'fake-refresh' })),

  http.post(`${BASE}/auth/refresh/`, () => HttpResponse.json({ access: 'new-access', refresh: 'new-refresh' })),

  http.patch(`${BASE}/auth/me/`, () => HttpResponse.json(mockUser)),

  http.post(`${BASE}/auth/change-password/`, () => HttpResponse.json({ detail: 'ok' })),

  http.post(`${BASE}/routines/`, () => HttpResponse.json({ ...mockRoutine, id: 99 }, { status: 201 })),

  http.patch(`${BASE}/routines/:id/`, async ({ request }) => {
    const body = await request.json()
    return HttpResponse.json({ ...mockRoutine, ...body })
  }),

  http.delete(`${BASE}/routines/:id/`, () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/stock/`, () =>
    HttpResponse.json(
      {
        id: 2,
        name: 'New Item',
        quantity: 0,
        group: null,
        group_name: null,
        lots: [],
        expiring_lots: [],
        has_expiring_lots: false,
        shared_with: [],
        shared_with_details: [],
        is_owner: true,
        owner_username: 'testuser',
      },
      { status: 201 },
    ),
  ),

  http.patch(`${BASE}/stock/:id/`, async ({ request, params }) => {
    const body = await request.json()
    return HttpResponse.json({
      id: Number(params.id),
      name: 'Filters',
      quantity: 5,
      group: null,
      group_name: null,
      lots: [],
      expiring_lots: [],
      has_expiring_lots: false,
      shared_with: [],
      shared_with_details: [],
      is_owner: true,
      owner_username: 'testuser',
      ...body,
    })
  }),

  http.delete(`${BASE}/stock/:id/`, () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/stock/:stockId/lots/`, () =>
    HttpResponse.json({ id: 10, quantity: 5, expiry_date: null, lot_number: '' }, { status: 201 }),
  ),

  http.delete(`${BASE}/stock/:stockId/lots/:lotId/`, () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/stock/:id/consume/`, ({ params }) =>
    HttpResponse.json({
      id: Number(params.id),
      name: 'Filters',
      quantity: 4,
      group: null,
      group_name: null,
      lots: [{ id: 100, quantity: 4, expiry_date: null, lot_number: '' }],
      expiring_lots: [],
      has_expiring_lots: false,
      requires_lot_selection: false,
      shared_with: [],
      shared_with_details: [],
      is_owner: true,
      owner_username: 'testuser',
    }),
  ),

  http.get(`${BASE}/stock/:id/lots-for-selection/`, () =>
    HttpResponse.json([{ lot_id: 100, lot_number: 'LOT-A', expiry_date: '2027-01-01', quantity: 2 }]),
  ),

  http.get(`${BASE}/push/vapid-public-key/`, () => HttpResponse.json({ public_key: 'BFake-VAPID-Key' })),

  http.post(`${BASE}/push/subscribe/`, () => HttpResponse.json({}, { status: 201 })),

  http.delete(`${BASE}/push/unsubscribe/`, () => new HttpResponse(null, { status: 204 })),
]
