import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import RoutineFormPage from '../RoutineFormPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

function renderCreate() {
  return renderWithProviders(
    <Routes>
      <Route path="/routines/new" element={<RoutineFormPage />} />
      <Route path="/routines/:id" element={<div>Detail</div>} />
    </Routes>,
    { initialEntries: ['/routines/new'] },
  )
}

function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/routines/:id/edit" element={<RoutineFormPage />} />
      <Route path="/routines/:id" element={<div>Detail</div>} />
    </Routes>,
    { initialEntries: ['/routines/1/edit'] },
  )
}

const editRoutine = {
  id: 1,
  name: 'Take vitamins',
  description: 'Daily',
  interval_hours: 168,
  is_active: true,
  stock: null,
  stock_usage: 1,
}

describe('RoutineFormPage', () => {
  it('shows "New routine" title in create mode', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('New routine')).toBeInTheDocument())
  })

  it('shows "Edit routine" title in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    renderEdit()
    await waitFor(() => expect(screen.getByText('Edit routine')).toBeInTheDocument())
  })

  it('pre-fills form fields in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Daily')).toBeInTheDocument()
  })

  it('shows error on load failure in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 500 })))
    renderEdit()
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('renders the IntervalPicker segmented tabs', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'hours' })).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'days' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'weeks' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'months' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'years' })).toBeInTheDocument()
  })

  it('defaults to Days=1 (24 hours) in create mode', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByRole('tab', { name: 'days' })).toHaveAttribute('aria-selected', 'true'))
  })

  it('switching the picker unit updates the submitted interval_hours', async () => {
    let capturedBody
    server.use(
      http.post(`${BASE}/routines/`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Weekly routine')
    // days=1 → click weeks → weeks=1 (168h).
    await user.click(screen.getByRole('tab', { name: 'weeks' }))
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(capturedBody?.interval_hours).toBe(168))
  })

  it('shows stock fields when track stock is checked', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 1, name: 'Filters', quantity: 5 }])))
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Stock tracking' })).toBeInTheDocument())

    await user.click(screen.getByRole('switch', { name: 'Stock tracking' }))
    await waitFor(() => expect(screen.getByText('Stock item')).toBeInTheDocument())
    expect(screen.getByText('Units used per log')).toBeInTheDocument()
  })

  it('shows validation error when name is empty', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())
    await user.click(screen.getByText('Save'))
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
  })

  it('shows error when create fails', async () => {
    server.use(http.post(`${BASE}/routines/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'New Routine')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('submits create form and navigates to detail', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'New Routine')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())
  })

  it('submits edit form and navigates to detail', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    const { user } = renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())
  })

  it('handles description textarea input', async () => {
    const { user, container } = renderCreate()
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())
    const descTextarea = container.querySelector('textarea')
    await user.type(descTextarea, 'Some description')
    expect(descTextarea.value).toBe('Some description')
  })

  it('renders cancel button that navigates back', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('Cancel')).toBeInTheDocument())
  })

  it('renders back button', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('← Back to routines')).toBeInTheDocument())
  })

  it('edits with stock pre-selected', async () => {
    const routineWithStock = {
      ...editRoutine,
      stock: 1,
      stock_usage: 2,
    }
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json(routineWithStock)),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 1, name: 'Filters', quantity: 5 }])),
    )
    renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
    expect(screen.getByText('Stock item')).toBeInTheDocument()
  })

  it('shows "already did this" checkbox in create mode', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Already completed' })).toBeInTheDocument())
  })

  it('does not show "already did this" checkbox in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
    expect(screen.queryByRole('switch', { name: 'Already completed' })).not.toBeInTheDocument()
  })

  it('checking "already did this" reveals datetime input with default value', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Already completed' })).toBeInTheDocument())

    expect(screen.queryByDisplayValue(/T/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Already completed' }))

    const datetimeInput = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(datetimeInput).toBeInTheDocument()
  })

  it('changing the datetime input updates the value', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Already completed' })).toBeInTheDocument())

    await user.click(screen.getByRole('switch', { name: 'Already completed' }))
    const datetimeInput = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    fireEvent.change(datetimeInput, { target: { value: '2026-02-27T10:00' } })
    expect(datetimeInput.value).toBe('2026-02-27T10:00')
  })

  it('submits with last_done_at when checkbox is checked', async () => {
    let capturedBody
    server.use(
      http.post(`${BASE}/routines/`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Water cactus')
    await user.click(screen.getByRole('switch', { name: 'Already completed' }))
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(capturedBody?.last_done_at).toBeDefined())
    expect(new Date(capturedBody.last_done_at).getTime()).not.toBeNaN()
  })

  it('shows saving state on submit', async () => {
    let resolve
    server.use(
      http.post(
        `${BASE}/routines/`,
        () =>
          new Promise((r) => {
            resolve = r
          }),
      ),
    )
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Test')
    await user.click(screen.getByText('Save'))

    expect(screen.getByText('Saving…')).toBeDisabled()
    resolve(HttpResponse.json({ id: 99 }, { status: 201 }))
  })

  it('shows owner name for shared stocks in dropdown', async () => {
    const sharedStock = { id: 2, name: 'Shared Item', quantity: 10, is_owner: false, owner_username: 'alice' }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([sharedStock])))
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Stock tracking' })).toBeInTheDocument())
    await user.click(screen.getByRole('switch', { name: 'Stock tracking' }))
    await waitFor(() => expect(screen.getByText('Stock item')).toBeInTheDocument())
    // Shared stock should show owner in the option
    const option = screen.getByText(/Shared Item.*alice/)
    expect(option).toBeInTheDocument()
  })

  it('does not show owner name for own stocks in dropdown', async () => {
    const ownStock = { id: 1, name: 'My Item', quantity: 5, is_owner: true, owner_username: 'me' }
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([ownStock])))
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Stock tracking' })).toBeInTheDocument())
    await user.click(screen.getByRole('switch', { name: 'Stock tracking' }))
    await waitFor(() => expect(screen.getByText('Stock item')).toBeInTheDocument())
    const option = screen.getByText('My Item (5 left)')
    expect(option).toBeInTheDocument()
    expect(screen.queryByText(/My Item.*me/)).not.toBeInTheDocument()
  })

  it('disables the submit button and shows a hint when offline in create mode', async () => {
    reachableRef.current = false
    try {
      renderCreate()
      const submit = await screen.findByRole('button', { name: /Save/i })
      expect(submit).toBeDisabled()
      expect(screen.getByText(/Requires connection/i)).toBeInTheDocument()
    } finally {
      reachableRef.current = true
    }
  })

  it('keeps the submit button enabled offline in edit mode', async () => {
    reachableRef.current = false
    try {
      server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
      renderEdit()
      const submit = await screen.findByRole('button', { name: /Save/i })
      expect(submit).not.toBeDisabled()
    } finally {
      reachableRef.current = true
    }
  })

  it('submits shared_with when a contact is selected via ShareWithSection', async () => {
    let capturedBody
    server.use(
      http.get(`${BASE}/auth/contacts/`, () =>
        HttpResponse.json([
          { id: 7, username: 'alice' },
          { id: 8, username: 'bob' },
        ]),
      ),
      http.post(`${BASE}/routines/`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    const { user } = renderCreate()
    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Shared routine')
    // Open the share modal from the section's button.
    await user.click(screen.getByRole('button', { name: /^share with/i }))
    const { within } = await import('@testing-library/react')
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('alice'))
    await user.keyboard('{Escape}')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(capturedBody?.shared_with).toEqual([7]))
  })

  it('turning off Stock tracking clears the stock fields before submit', async () => {
    let capturedBody
    server.use(
      http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 1, name: 'Filters', quantity: 5 }])),
      http.post(`${BASE}/routines/`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    const { user } = renderCreate()
    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Toggle reset')

    const toggle = await screen.findByRole('switch', { name: 'Stock tracking' })
    // Turn on + pick stock.
    await user.click(toggle)
    // The Field wrapper keeps label + select as siblings; grab the combobox directly.
    await waitFor(() => expect(screen.getByText('Stock item')).toBeInTheDocument())
    await user.selectOptions(screen.getByRole('combobox'), '1')
    // Turn off → fields should be reset in state.
    await user.click(toggle)

    await user.click(screen.getByText('Save'))
    await waitFor(() => expect(capturedBody?.stock).toBeNull())
    expect(capturedBody.stock_usage).toBe(1)
  })

  it('prefills the shared_with chips when editing a routine shared with contacts', async () => {
    server.use(
      http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json([{ id: 7, username: 'alice' }])),
      http.get(`${BASE}/routines/1/`, () =>
        HttpResponse.json({ ...editRoutine, shared_with: [7], shared_with_details: [{ id: 7, username: 'alice' }] }),
      ),
    )
    renderEdit()
    expect(await screen.findByDisplayValue('Take vitamins')).toBeInTheDocument()
    // Chip for alice must be visible in the share section.
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())
  })

  describe('coupled-share popup', () => {
    const baseStock = {
      id: 1,
      name: 'Filters',
      quantity: 5,
      shared_with: [],
      shared_with_details: [],
      updated_at: '2026-03-01T10:00:00Z',
      is_owner: true,
      owner_username: 'testuser',
      lots: [],
      expiring_lots: [],
      stock_severity: 'ok',
      expiry_severity: 'ok',
    }
    const routineWithStock = {
      ...editRoutine,
      stock: 1,
      stock_usage: 1,
      shared_with: [],
      shared_with_details: [],
      updated_at: '2026-03-01T11:00:00Z',
    }
    const contacts = [
      { id: 7, username: 'alice' },
      { id: 8, username: 'bob' },
    ]

    function setupCachedScenario({ stock = baseStock, routine = routineWithStock, contactsList = contacts } = {}) {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      qc.setQueryData(['stock'], [stock])
      qc.setQueryData(['stock', stock.id], stock)
      server.use(
        http.get(`${BASE}/auth/contacts/`, () => HttpResponse.json(contactsList)),
        http.get(`${BASE}/stock/`, () => HttpResponse.json([stock])),
        http.get(`${BASE}/stock/${stock.id}/`, () => HttpResponse.json(stock)),
        http.get(`${BASE}/routines/${routine.id}/`, () => HttpResponse.json(routine)),
      )
      return renderWithProviders(
        <Routes>
          <Route path="/routines/:id/edit" element={<RoutineFormPage />} />
          <Route path="/routines/:id" element={<div>Detail</div>} />
        </Routes>,
        { initialEntries: [`/routines/${routine.id}/edit`], queryClient: qc },
      )
    }

    async function addContactToShare(user, username) {
      await user.click(screen.getByRole('button', { name: /^share with/i }))
      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByText(username))
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    }

    it('shows the popup when stock is linked and the new recipient is not in stock.shared_with', async () => {
      const { user } = setupCachedScenario()
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      // The interpolated message includes the stock name and username.
      expect(await screen.findByText(/Filters.*alice/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Share both' })).toBeInTheDocument()
    })

    it('does not show the popup when every new recipient already has stock access', async () => {
      let routineCalled = false
      server.use(
        http.patch(`${BASE}/routines/1/`, async ({ request }) => {
          routineCalled = true
          const body = await request.json()
          return HttpResponse.json({ ...routineWithStock, ...body })
        }),
      )
      const stock = { ...baseStock, shared_with: [7] }
      const { user } = setupCachedScenario({ stock })
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())
      expect(routineCalled).toBe(true)
      expect(screen.queryByRole('button', { name: 'Share both' })).not.toBeInTheDocument()
    })

    it('does not show the popup when the routine has no linked stock', async () => {
      const routine = { ...routineWithStock, stock: null, stock_usage: 1 }
      let routineCalled = false
      server.use(
        http.patch(`${BASE}/routines/1/`, async ({ request }) => {
          routineCalled = true
          const body = await request.json()
          return HttpResponse.json({ ...routine, ...body })
        }),
      )
      const { user } = setupCachedScenario({ routine })
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())
      expect(routineCalled).toBe(true)
      expect(screen.queryByRole('button', { name: 'Share both' })).not.toBeInTheDocument()
    })

    it('does not show the popup when only existing recipients are removed', async () => {
      const routine = {
        ...routineWithStock,
        shared_with: [7],
        shared_with_details: [{ id: 7, username: 'alice' }],
      }
      let routineCalled = false
      let capturedBody
      server.use(
        http.patch(`${BASE}/routines/1/`, async ({ request }) => {
          routineCalled = true
          capturedBody = await request.json()
          return HttpResponse.json({ ...routine, ...capturedBody })
        }),
      )
      const { user } = setupCachedScenario({ routine })
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
      // Wait for the prefilled chip.
      await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument())

      // Remove alice via the chip's labelled X button.
      await user.click(screen.getByRole('button', { name: 'Unshare with alice' }))
      await user.click(screen.getByText('Save'))

      await waitFor(() => expect(routineCalled).toBe(true))
      expect(capturedBody?.shared_with).toEqual([])
      expect(screen.queryByRole('button', { name: 'Share both' })).not.toBeInTheDocument()
    })

    it('Cancel closes the popup and calls neither mutation', async () => {
      let stockCalled = false
      let routineCalled = false
      server.use(
        http.patch(`${BASE}/stock/1/`, () => {
          stockCalled = true
          return HttpResponse.json(baseStock)
        }),
        http.patch(`${BASE}/routines/1/`, () => {
          routineCalled = true
          return HttpResponse.json(routineWithStock)
        }),
      )
      const { user } = setupCachedScenario()
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(stockCalled).toBe(false)
      expect(routineCalled).toBe(false)
      // The form is still open.
      expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument()
    })

    it('Confirm calls stock first then routine, with the merged shared_with payload', async () => {
      const callOrder = []
      let stockBody, routineBody, stockHeaders, routineHeaders
      server.use(
        http.patch(`${BASE}/stock/1/`, async ({ request }) => {
          stockBody = await request.json()
          stockHeaders = Object.fromEntries(request.headers.entries())
          callOrder.push('stock')
          return HttpResponse.json({ ...baseStock, ...stockBody })
        }),
        http.patch(`${BASE}/routines/1/`, async ({ request }) => {
          routineBody = await request.json()
          routineHeaders = Object.fromEntries(request.headers.entries())
          callOrder.push('routine')
          return HttpResponse.json({ ...routineWithStock, ...routineBody })
        }),
      )
      const stockWithExisting = { ...baseStock, shared_with: [8] } // bob already has access
      const { user } = setupCachedScenario({ stock: stockWithExisting })
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Share both' }))

      await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())

      expect(callOrder).toEqual(['stock', 'routine'])
      // Existing recipient (bob=8) preserved, new recipient (alice=7) appended.
      expect(new Set(stockBody?.shared_with)).toEqual(new Set([8, 7]))
      expect(routineBody?.shared_with).toEqual([7])
      // If-Unmodified-Since carries the cached timestamps (converted to UTC string by the api client).
      expect(stockHeaders?.['if-unmodified-since']).toBe(new Date(stockWithExisting.updated_at).toUTCString())
      expect(routineHeaders?.['if-unmodified-since']).toBe(new Date(routineWithStock.updated_at).toUTCString())
    })

    it('shows stockShareFailed and skips the routine call when stock PATCH errors', async () => {
      let routineCalled = false
      server.use(
        http.patch(`${BASE}/stock/1/`, () => new HttpResponse(null, { status: 500 })),
        http.patch(`${BASE}/routines/1/`, () => {
          routineCalled = true
          return HttpResponse.json(routineWithStock)
        }),
      )
      const { user } = setupCachedScenario()
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Share both' }))

      await waitFor(() =>
        expect(
          screen.getByText(/Couldn't share the linked stock\. The routine wasn't saved either/),
        ).toBeInTheDocument(),
      )
      expect(routineCalled).toBe(false)
      // Form stays open, no nav.
      expect(screen.queryByText('Detail')).not.toBeInTheDocument()
    })

    it('shows routineSavedAfterStockShared when routine fails after stock succeeds', async () => {
      const callOrder = []
      server.use(
        http.patch(`${BASE}/stock/1/`, async ({ request }) => {
          callOrder.push('stock')
          const body = await request.json()
          return HttpResponse.json({ ...baseStock, ...body })
        }),
        http.patch(`${BASE}/routines/1/`, () => {
          callOrder.push('routine')
          return new HttpResponse(null, { status: 500 })
        }),
      )
      const { user } = setupCachedScenario()
      await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

      await addContactToShare(user, 'alice')
      await user.click(screen.getByText('Save'))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Share both' }))

      await waitFor(() =>
        expect(screen.getByText(/The stock was shared, but the routine couldn't be saved/)).toBeInTheDocument(),
      )
      expect(callOrder).toEqual(['stock', 'routine'])
      // Form stays open, no nav.
      expect(screen.queryByText('Detail')).not.toBeInTheDocument()
    })
  })
})
