import { screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import HistoryPage from '../HistoryPage'

const BASE = 'http://localhost/api'

describe('HistoryPage', () => {
  it('shows loading state initially', () => {
    renderWithProviders(<HistoryPage />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
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
    server.use(
      http.get(`${BASE}/entries/`, () =>
        HttpResponse.json({
          results: [
            { id: 1, routine_name: 'Vitamins', created_at: '2025-02-20T09:00:00Z' },
            { id: 2, routine_name: 'Water filter', created_at: '2025-02-20T15:00:00Z' },
          ],
          next: null,
        }),
      ),
    )
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Vitamins')).toBeInTheDocument())
    expect(screen.getByText('Water filter')).toBeInTheDocument()
  })

  it('renders routine filter dropdown', async () => {
    server.use(
      http.get(`${BASE}/routines/`, () =>
        HttpResponse.json([
          { id: 1, name: 'Vitamins' },
          { id: 2, name: 'Water filter' },
        ]),
      ),
    )
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('All routines')).toBeInTheDocument())
  })

  it('shows load more button when there is a next page', async () => {
    server.use(
      http.get(`${BASE}/entries/`, () =>
        HttpResponse.json({
          results: [{ id: 1, routine_name: 'Vitamins', created_at: '2025-02-20T09:00:00Z' }],
          next: '/api/entries/?page=2',
        }),
      ),
    )
    renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument())
  })

  it('loads more entries when button clicked', async () => {
    let page = 1
    server.use(
      http.get(`${BASE}/entries/`, ({ request }) => {
        const url = new URL(request.url)
        const p = url.searchParams.get('page') || '1'
        if (p === '1') {
          return HttpResponse.json({
            results: [{ id: 1, routine_name: 'Vitamins', created_at: '2025-02-20T09:00:00Z' }],
            next: '/api/entries/?page=2',
          })
        }
        return HttpResponse.json({
          results: [{ id: 2, routine_name: 'Water filter', created_at: '2025-02-19T09:00:00Z' }],
          next: null,
        })
      }),
    )
    const { user } = renderWithProviders(<HistoryPage />)
    await waitFor(() => expect(screen.getByText('Load more')).toBeInTheDocument())
    await user.click(screen.getByText('Load more'))
    await waitFor(() => expect(screen.getByText('Water filter')).toBeInTheDocument())
  })

  it('renders History title', async () => {
    renderWithProviders(<HistoryPage />)
    expect(screen.getByText('History')).toBeInTheDocument()
  })
})
