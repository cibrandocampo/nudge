import { http, HttpResponse } from 'msw'

const BASE = 'http://localhost/api'

export const mockUser = {
  id: 1,
  username: 'testuser',
  is_staff: false,
  timezone: 'Europe/Madrid',
  language: 'en',
  daily_notification_time: '08:00:00',
}

export const mockRoutine = {
  id: 1,
  name: 'Take vitamins',
  description: 'Daily vitamins',
  interval_hours: 24,
  is_active: true,
  is_due: true,
  hours_until_due: -2,
  next_due_at: new Date(Date.now() - 2 * 3600000).toISOString(),
  created_at: '2025-01-15T10:00:00Z',
  stock_name: null,
  stock_quantity: null,
  stock_usage: 1,
  stock: null,
}

export const handlers = [
  http.get(`${BASE}/auth/me/`, () => HttpResponse.json(mockUser)),

  http.get(`${BASE}/dashboard/`, () => HttpResponse.json({ due: [], upcoming: [] })),

  http.get(`${BASE}/routines/`, () => HttpResponse.json([])),

  http.get(`${BASE}/routines/:id/`, () => HttpResponse.json(mockRoutine)),

  http.get(`${BASE}/routines/:id/entries/`, () => HttpResponse.json([])),

  http.get(`${BASE}/routines/:id/lots-for-selection/`, () =>
    HttpResponse.json([
      { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', unit_index: 1 },
      { lot_id: 1, lot_number: 'LOT-A', expiry_date: '2027-01-01', unit_index: 2 },
      { lot_id: 2, lot_number: null, expiry_date: null, unit_index: 1 },
    ]),
  ),

  http.post(`${BASE}/routines/:id/log/`, () => HttpResponse.json({ id: 1 }, { status: 201 })),

  http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: [], next: null })),

  http.get(`${BASE}/stock/`, () => HttpResponse.json([])),

  http.get(`${BASE}/stock/:id/`, () =>
    HttpResponse.json({ id: 1, name: 'Filters', quantity: 5, lots: [], expiring_lots: [], has_expiring_lots: false }),
  ),

  http.post(`${BASE}/auth/token/`, () => HttpResponse.json({ access: 'fake-access', refresh: 'fake-refresh' })),

  http.post(`${BASE}/auth/refresh/`, () => HttpResponse.json({ access: 'new-access' })),

  http.patch(`${BASE}/auth/me/`, () => HttpResponse.json(mockUser)),

  http.post(`${BASE}/auth/change-password/`, () => HttpResponse.json({ detail: 'ok' })),

  http.post(`${BASE}/routines/`, () => HttpResponse.json({ ...mockRoutine, id: 99 }, { status: 201 })),

  http.patch(`${BASE}/routines/:id/`, () => HttpResponse.json(mockRoutine)),

  http.delete(`${BASE}/routines/:id/`, () => new HttpResponse(null, { status: 204 })),

  http.post(`${BASE}/stock/`, () =>
    HttpResponse.json(
      { id: 2, name: 'New Item', quantity: 0, lots: [], expiring_lots: [], has_expiring_lots: false },
      { status: 201 },
    ),
  ),

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
      lots: [{ id: 100, quantity: 4, expiry_date: null, lot_number: '' }],
      expiring_lots: [],
      has_expiring_lots: false,
      requires_lot_selection: false,
    }),
  ),

  http.get(`${BASE}/stock/:id/lots-for-selection/`, () =>
    HttpResponse.json([
      { lot_id: 100, lot_number: 'LOT-A', expiry_date: '2027-01-01', unit_index: 1 },
      { lot_id: 100, lot_number: 'LOT-A', expiry_date: '2027-01-01', unit_index: 2 },
    ]),
  ),

  http.get(`${BASE}/push/vapid-public-key/`, () => HttpResponse.json({ public_key: 'BFake-VAPID-Key' })),

  http.post(`${BASE}/push/subscribe/`, () => HttpResponse.json({}, { status: 201 })),

  http.delete(`${BASE}/push/unsubscribe/`, () => new HttpResponse(null, { status: 204 })),
]
