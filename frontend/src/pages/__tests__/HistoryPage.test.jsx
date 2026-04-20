import { screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { list } from '../../offline/queue'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import HistoryPage from '../HistoryPage'

const BASE = 'http://localhost/api'

const mockEntries = [
  {
    id: 1,
    routine: 1,
    routine_name: 'Take vitamins',
    stock_name: 'Vitamin D',
    created_at: '2026-03-01T09:00:00Z',
    notes: 'morning dose',
    consumed_lots: [{ lot_number: 'LOT-V1', expiry_date: '2027-01-01', quantity: 1 }],
  },
  {
    id: 2,
    routine: 2,
    routine_name: 'Water filter',
    stock_name: null,
    created_at: '2026-03-01T15:00:00Z',
    notes: '',
    consumed_lots: [],
  },
]

const mockConsumptions = [
  {
    id: 1,
    stock: 1,
    stock_name: 'Insulin pens',
    quantity: 1,
    consumed_lots: [{ lot_number: null, expiry_date: '2026-06-01', quantity: 1 }],
    notes: '',
    created_at: '2026-03-01T10:00:00Z',
  },
]

const mockStocks = [{ id: 1, name: 'Insulin pens', quantity: 5, lots: [], expiring_lots: [], has_expiring_lots: false }]

function setupHandlers({ entries = mockEntries, consumptions = mockConsumptions, stocks = mockStocks } = {}) {
  server.use(
    http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: entries, next: null })),
    http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: consumptions, next: null })),
    http.get(`${BASE}/stock/`, () => HttpResponse.json({ results: stocks })),
    http.get(`${BASE}/routines/`, () =>
      HttpResponse.json([
        { id: 1, name: 'Take vitamins' },
        { id: 2, name: 'Water filter' },
      ]),
    ),
  )
}

/** Get entry names from .entryName spans (avoids matching <option> elements). */
function getEntryNames(container) {
  return [...container.querySelectorAll('.entryName')].map((el) => el.textContent)
}

describe('HistoryPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<HistoryPage />)
    expect(screen.getByTestId('spinner')).toBeInTheDocument()
  })

  it('shows error state on API failure', async () => {
    server.use(http.get(`${BASE}/entries/`, () => new HttpResponse(null, { status: 500 })))
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('shows empty state when no entries', async () => {
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('No entries found.')).toBeInTheDocument())
  })

  it('renders entries grouped by date', async () => {
    setupHandlers({ consumptions: [] })
    const { container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))
    expect(getEntryNames(container)).toContain('Water filter')
  })

  it('renders routine filter dropdown', async () => {
    setupHandlers()
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('All routines')).toBeInTheDocument())
  })

  it('shows load more button when there is a next page', async () => {
    server.use(
      http.get(`${BASE}/entries/`, () =>
        HttpResponse.json({
          results: [
            { id: 1, routine_name: 'Vitamins', created_at: '2025-02-20T09:00:00Z', notes: '', consumed_lots: [] },
          ],
          next: '/api/entries/?page=2',
        }),
      ),
    )
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument())
  })

  it('loads more entries when button clicked', async () => {
    server.use(
      http.get(`${BASE}/entries/`, ({ request }) => {
        const url = new URL(request.url)
        const p = url.searchParams.get('page') || '1'
        if (p === '1') {
          return HttpResponse.json({
            results: [
              { id: 1, routine_name: 'Vitamins', created_at: '2025-02-20T09:00:00Z', notes: '', consumed_lots: [] },
            ],
            next: '/api/entries/?page=2',
          })
        }
        return HttpResponse.json({
          results: [
            {
              id: 2,
              routine_name: 'Replaced filter',
              created_at: '2025-02-19T09:00:00Z',
              notes: '',
              consumed_lots: [],
            },
          ],
          next: null,
        })
      }),
    )
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument())
    await user.click(screen.getByText('Load more'))
    await waitFor(() => expect(getEntryNames(container)).toContain('Replaced filter'))
  })

  it('shows loading label on the pagination button while the next page is in flight', async () => {
    let resolveSecond
    server.use(
      http.get(`${BASE}/entries/`, ({ request }) => {
        const p = new URL(request.url).searchParams.get('page') || '1'
        if (p === '1') {
          return HttpResponse.json({
            results: [
              { id: 1, routine_name: 'Vitamins', created_at: '2025-02-20T09:00:00Z', notes: '', consumed_lots: [] },
            ],
            next: '/api/entries/?page=2',
          })
        }
        return new Promise((r) => {
          resolveSecond = r
        })
      }),
    )
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument())
    await user.click(screen.getByText('Load more'))
    await waitFor(() => expect(screen.getByText('Loading…')).toBeInTheDocument())
    resolveSecond(HttpResponse.json({ results: [], next: null }))
  })

  it('renders History title', async () => {
    renderWithProviders(<HistoryPage />)
    expect(screen.getByText('History')).toBeInTheDocument()
  })
})

describe('HistoryPage — date range', () => {
  it('applies a date range via the picker', async () => {
    setupHandlers()
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container).length).toBeGreaterThan(0))

    // Open date range picker by clicking the trigger button (shows "Last 15 days" default)
    const toggleBtn = screen.getByText('Last 15 days')
    await user.click(toggleBtn)

    // Select "Last 30 days" preset
    await user.click(screen.getByText('Last 30 days'))

    // After applying, the entries should re-render (with same mock data)
    await waitFor(() => expect(getEntryNames(container).length).toBeGreaterThan(0))
  })
})

describe('HistoryPage — type filter', () => {
  it('default shows both routines and consumptions', async () => {
    setupHandlers()
    const { container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => {
      const names = getEntryNames(container)
      expect(names).toContain('Take vitamins')
      expect(names).toContain('Insulin pens')
    })
  })

  it('filter by routines only hides consumptions', async () => {
    setupHandlers()
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))

    const typeSelect = screen.getByDisplayValue('All')
    await user.selectOptions(typeSelect, 'routines')

    await waitFor(() => {
      const names = getEntryNames(container)
      expect(names).toContain('Take vitamins')
      expect(names).not.toContain('Insulin pens')
    })
  })

  it('filter by consumptions only hides routine entries', async () => {
    setupHandlers()
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))

    const typeSelect = screen.getByDisplayValue('All')
    await user.selectOptions(typeSelect, 'consumptions')

    await waitFor(() => {
      const names = getEntryNames(container)
      expect(names).toContain('Insulin pens')
      expect(names).not.toContain('Take vitamins')
    })
  })

  it('stock filter appears when consumptions or all selected', async () => {
    setupHandlers()
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('All items')).toBeInTheDocument())
  })

  it('stock filter hidden when routines only selected', async () => {
    setupHandlers()
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))

    const typeSelect = screen.getByDisplayValue('All')
    await user.selectOptions(typeSelect, 'routines')

    await waitFor(() => {
      expect(screen.queryByText('All items')).not.toBeInTheDocument()
    })
  })
})

describe('HistoryPage — consumption entries display', () => {
  it('consumption entries show stock name and −1 badge', async () => {
    setupHandlers({ entries: [] })
    const { container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Insulin pens'))
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('routine entries show ✓ badge', async () => {
    setupHandlers({ consumptions: [] })
    const { container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))
    const badges = screen.getAllByText('✓')
    expect(badges.length).toBeGreaterThan(0)
  })

  it('routine entries show consumed stock as "N × name (lot)"', async () => {
    setupHandlers({ consumptions: [] })
    const { container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))
    // Take vitamins consumed 1 unit of Vitamin D from LOT-V1
    expect(screen.getByText(/1 × Vitamin D/)).toBeInTheDocument()
    expect(screen.getByText(/LOT-V1/)).toBeInTheDocument()
  })

  it('merged list sorted by created_at descending', async () => {
    setupHandlers()
    const { container } = renderWithProviders(<HistoryPage />)
    // All on same date (2026-03-01): Water filter 15:00 > Insulin pens 10:00 > Take vitamins 09:00
    await waitFor(() => expect(getEntryNames(container).length).toBe(3))
    const names = getEntryNames(container)
    expect(names.indexOf('Water filter')).toBeLessThan(names.indexOf('Insulin pens'))
    expect(names.indexOf('Insulin pens')).toBeLessThan(names.indexOf('Take vitamins'))
  })
})

describe('HistoryPage — notes editing', () => {
  it('shows notes placeholder for entries without notes', async () => {
    setupHandlers()
    renderWithProviders(<HistoryPage />)
    await waitFor(() => {
      const placeholders = screen.getAllByText('Add a note…')
      expect(placeholders.length).toBeGreaterThan(0)
    })
  })

  it('shows existing notes text', async () => {
    setupHandlers()
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('morning dose')).toBeInTheDocument())
  })

  it('edit notes on routine entry via click and blur', async () => {
    let patchCalled = false
    server.use(
      http.patch(`${BASE}/entries/:id/`, async ({ request }) => {
        const body = await request.json()
        patchCalled = true
        return HttpResponse.json({
          id: 1,
          routine: 1,
          routine_name: 'Take vitamins',
          created_at: '2026-03-01T09:00:00Z',
          notes: body.notes,
          consumed_lots: [],
        })
      }),
    )
    setupHandlers()
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('morning dose')).toBeInTheDocument())

    // Click notes to enter edit mode
    await user.click(screen.getByText('morning dose'))

    // Should now have an input
    const input = screen.getByDisplayValue('morning dose')
    await user.clear(input)
    await user.type(input, 'updated note')
    input.blur()

    await waitFor(() => expect(patchCalled).toBe(true))
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument())
  })

  it('saves note on Enter key press', async () => {
    let patchCalled = false
    server.use(
      http.patch(`${BASE}/entries/:id/`, async ({ request }) => {
        const body = await request.json()
        patchCalled = true
        return HttpResponse.json({
          id: 1,
          routine: 1,
          routine_name: 'Take vitamins',
          created_at: '2026-03-01T09:00:00Z',
          notes: body.notes,
          consumed_lots: [],
        })
      }),
    )
    setupHandlers()
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('morning dose')).toBeInTheDocument())

    await user.click(screen.getByText('morning dose'))
    const input = screen.getByDisplayValue('morning dose')
    await user.clear(input)
    await user.type(input, 'enter note{Enter}')

    await waitFor(() => expect(patchCalled).toBe(true))
  })

  it('edit notes on consumption entry', async () => {
    let patchCalled = false
    server.use(
      http.patch(`${BASE}/stock-consumptions/:id/`, async ({ request }) => {
        const body = await request.json()
        patchCalled = true
        return HttpResponse.json({
          id: 1,
          stock: 1,
          stock_name: 'Insulin pens',
          quantity: 1,
          consumed_lots: [],
          notes: body.notes,
          created_at: '2026-03-01T10:00:00Z',
        })
      }),
    )
    // Use only consumption entries (no routine entries) to avoid ambiguity
    setupHandlers({ entries: [] })
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Insulin pens'))

    // Consumption has empty notes, click the placeholder
    const placeholder = screen.getByText('Add a note…')
    await user.click(placeholder)

    const input = screen.getByPlaceholderText('Add a note…')
    await user.type(input, 'my consumption note')
    input.blur()

    await waitFor(() => expect(patchCalled).toBe(true))
  })
})

describe('HistoryPage — consumption fetch edge cases', () => {
  it('handles consumptions API failure gracefully', async () => {
    server.use(
      http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: mockEntries, next: null })),
      http.get(`${BASE}/stock-consumptions/`, () => new HttpResponse(null, { status: 500 })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json({ results: mockStocks })),
      http.get(`${BASE}/routines/`, () => HttpResponse.json([{ id: 1, name: 'Take vitamins' }])),
    )
    const { container } = renderWithProviders(<HistoryPage />)
    // Should still show routine entries even if consumptions fail
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))
  })

  it('handles consumptions response without results wrapper', async () => {
    server.use(
      http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json(mockConsumptions)),
      http.get(`${BASE}/stock/`, () => HttpResponse.json({ results: mockStocks })),
      http.get(`${BASE}/routines/`, () => HttpResponse.json([])),
    )
    const { container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Insulin pens'))
  })
})

describe('HistoryPage — note editing edge cases', () => {
  it('cancels note editing on Escape key', async () => {
    setupHandlers()
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('morning dose')).toBeInTheDocument())

    await user.click(screen.getByText('morning dose'))
    const input = screen.getByDisplayValue('morning dose')
    await user.keyboard('{Escape}')

    // Should exit edit mode — input should be gone
    expect(screen.queryByDisplayValue('morning dose')).not.toBeInTheDocument()
    // Notes text should still show
    expect(screen.getByText('morning dose')).toBeInTheDocument()
  })

  it('queues the note edit offline when the PATCH hits a network error', async () => {
    // T065: we no longer surface a per-action "queued" toast; the entry
    // lands in the offline queue and the optimistic update keeps the note
    // visible until sync.
    server.use(http.patch(`${BASE}/entries/:id/`, () => HttpResponse.error()))
    setupHandlers()
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('morning dose')).toBeInTheDocument())

    await user.click(screen.getByText('morning dose'))
    const input = screen.getByDisplayValue('morning dose')
    await user.clear(input)
    await user.type(input, 'queued note')
    input.blur()

    await waitFor(async () => expect(await list()).toHaveLength(1))
  })

  it('does not save when API returns error', async () => {
    server.use(http.patch(`${BASE}/entries/:id/`, () => new HttpResponse(null, { status: 500 })))
    setupHandlers()
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('morning dose')).toBeInTheDocument())

    await user.click(screen.getByText('morning dose'))
    const input = screen.getByDisplayValue('morning dose')
    await user.clear(input)
    await user.type(input, 'fail note')
    input.blur()

    // "Saved" should NOT appear since API returned 500
    await waitFor(() => expect(screen.queryByText('Saved')).not.toBeInTheDocument())
  })

  it('filters stock consumptions by stock', async () => {
    setupHandlers()
    const { user } = renderWithProviders(<HistoryPage />)
    // Wait for the stock dropdown option to be populated from the query before
    // attempting to select it.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Insulin pens' })).toBeInTheDocument())

    const stockSelect = screen.getByDisplayValue('All items')
    await user.selectOptions(stockSelect, '1')

    // Should still show the page (API re-fetches)
    await waitFor(() => expect(screen.getByText('History')).toBeInTheDocument())
  })

  it('filters routine entries by routine', async () => {
    setupHandlers()
    const { user, container } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(getEntryNames(container)).toContain('Take vitamins'))

    const routineSelect = screen.getByDisplayValue('All routines')
    await user.selectOptions(routineSelect, '1')

    await waitFor(() => expect(screen.getByText('History')).toBeInTheDocument())
  })
})

describe('HistoryPage — sharing', () => {
  it('shows completed_by username on routine entries', async () => {
    const entriesWithUser = [
      {
        ...mockEntries[0],
        completed_by_username: 'alice',
      },
    ]
    server.use(
      http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: entriesWithUser, next: null })),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json({ results: [] })),
      http.get(`${BASE}/routines/`, () => HttpResponse.json([])),
    )
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
    expect(screen.getByText(/by alice/)).toBeInTheDocument()
  })

  it('shows consumed_by username on stock consumptions', async () => {
    const consumptionsWithUser = [
      {
        ...mockConsumptions[0],
        consumed_by_username: 'bob',
      },
    ]
    server.use(
      http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: consumptionsWithUser, next: null })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json({ results: [] })),
      http.get(`${BASE}/routines/`, () => HttpResponse.json([])),
    )
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Insulin pens')).toBeInTheDocument())
    expect(screen.getByText(/by bob/)).toBeInTheDocument()
  })
})

describe('HistoryPage — API format variants', () => {
  it('handles routines paginated response format', async () => {
    server.use(
      http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([])),
      http.get(`${BASE}/routines/`, () => HttpResponse.json({ results: [{ id: 1, name: 'Take vitamins' }], count: 1 })),
    )
    renderWithProviders(<HistoryPage />)
    // Wait for the routine filter to appear (populated from API response)
    await waitFor(() => expect(screen.getByText('Take vitamins')).toBeInTheDocument())
  })

  it('handles stocks plain array response format', async () => {
    server.use(
      http.get(`${BASE}/entries/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock-consumptions/`, () => HttpResponse.json({ results: [], next: null })),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 1, name: 'Filters', quantity: 5 }])),
      http.get(`${BASE}/routines/`, () => HttpResponse.json([])),
    )
    renderWithProviders(<HistoryPage />)
    // Wait for the stock filter to appear (populated from API response)
    await waitFor(() => expect(screen.getByText('Filters')).toBeInTheDocument())
  })
})
