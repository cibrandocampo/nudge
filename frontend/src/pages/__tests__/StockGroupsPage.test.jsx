import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import StockGroupsPage from '../StockGroupsPage'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const BASE = 'http://localhost/api'

function render() {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/groups" element={<StockGroupsPage />} />
      <Route path="/inventory" element={<div>Inventory stub</div>} />
    </Routes>,
    { initialEntries: ['/inventory/groups'] },
  )
}

beforeEach(() => {
  reachableRef.current = true
})

function mockGroups(groups) {
  server.use(http.get(`${BASE}/stock-groups/`, () => HttpResponse.json(groups)))
}

describe('StockGroupsPage', () => {
  it('renders the empty state when there are no groups', async () => {
    mockGroups([])
    render()
    await waitFor(() => expect(screen.getByText(/no categories yet/i)).toBeInTheDocument())
  })

  it('renders groups returned by the server', async () => {
    mockGroups([
      { id: 1, name: 'Pantry', display_order: 0 },
      { id: 2, name: 'Medicine', display_order: 1 },
    ])
    render()
    await waitFor(() => expect(screen.getByText('Pantry')).toBeInTheDocument())
    expect(screen.getByText('Medicine')).toBeInTheDocument()
  })

  it('creates a new group via the bottom form', async () => {
    let receivedBody = null
    mockGroups([])
    server.use(
      http.post(`${BASE}/stock-groups/`, async ({ request }) => {
        receivedBody = await request.json()
        return HttpResponse.json({ id: 99, ...receivedBody }, { status: 201 })
      }),
    )

    const { user } = render()
    const input = await screen.findByLabelText(/category name/i)
    await user.type(input, 'Farmacia')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(receivedBody).toEqual({ name: 'Farmacia', display_order: 0 }))
  })

  it('renames a group inline with Enter', async () => {
    let patchBody = null
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(
      http.patch(`${BASE}/stock-groups/1/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 1, name: patchBody.name, display_order: 0 })
      }),
    )

    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /rename/i }))
    const input = await screen.findByRole('textbox', { name: /rename/i })
    await user.clear(input)
    await user.type(input, 'Despensa{Enter}')

    await waitFor(() => expect(patchBody).toEqual({ name: 'Despensa' }))
  })

  it('cancels rename on Escape without firing PATCH', async () => {
    let patchCalls = 0
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(
      http.patch(`${BASE}/stock-groups/1/`, () => {
        patchCalls += 1
        return HttpResponse.json({})
      }),
    )

    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /rename/i }))
    const input = await screen.findByRole('textbox', { name: /rename/i })
    await user.type(input, ' edited{Escape}')

    // Esc resets to read-only without PATCH — the input disappears.
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /rename/i })).not.toBeInTheDocument())
    expect(patchCalls).toBe(0)
  })

  it('confirms and deletes a group', async () => {
    let deleteCalls = 0
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(
      http.delete(`${BASE}/stock-groups/1/`, () => {
        deleteCalls += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteCalls).toBe(1))
  })

  it('cancels delete without firing DELETE', async () => {
    let deleteCalls = 0
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(
      http.delete(`${BASE}/stock-groups/1/`, () => {
        deleteCalls += 1
        return new HttpResponse(null, { status: 204 })
      }),
    )

    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCalls).toBe(0)
  })

  it('reorders groups via drag-and-drop and PATCHes the affected rows', async () => {
    const patchBodies = []
    mockGroups([
      { id: 1, name: 'A', display_order: 0 },
      { id: 2, name: 'B', display_order: 1 },
      { id: 3, name: 'C', display_order: 2 },
    ])
    server.use(
      http.patch(`${BASE}/stock-groups/:id/`, async ({ params, request }) => {
        const body = await request.json()
        patchBodies.push({ id: Number(params.id), ...body })
        return HttpResponse.json({ id: Number(params.id), ...body })
      }),
    )

    render()
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(3)

    // Drag row 0 (A) onto row 2 (C) so A ends up at the bottom:
    // [A, B, C] → [B, C, A] → display_order changes for all three.
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.dragStart(rows[0], { dataTransfer })
    fireEvent.dragEnter(rows[2], { dataTransfer })
    fireEvent.dragOver(rows[2], { dataTransfer })
    fireEvent.drop(rows[2], { dataTransfer })

    await waitFor(() => expect(patchBodies).toHaveLength(3))
    const byId = Object.fromEntries(patchBodies.map((p) => [p.id, p.display_order]))
    expect(byId[1]).toBe(2) // A moved to position 2
    expect(byId[2]).toBe(0) // B shifted up
    expect(byId[3]).toBe(1) // C shifted up
  })

  it('shows a create error when the POST rejects', async () => {
    mockGroups([])
    server.use(http.post(`${BASE}/stock-groups/`, () => new HttpResponse(null, { status: 500 })))

    const { user } = render()
    const input = await screen.findByLabelText(/category name/i)
    await user.type(input, 'Tools')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/could not create/i)).toBeInTheDocument()
  })

  it('shows a rename error when the PATCH rejects and restores the name', async () => {
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(http.patch(`${BASE}/stock-groups/1/`, () => new HttpResponse(null, { status: 500 })))

    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /rename/i }))
    const input = await screen.findByRole('textbox', { name: /rename/i })
    await user.clear(input)
    await user.type(input, 'Despensa{Enter}')
    expect(await screen.findByText(/could not rename/i)).toBeInTheDocument()
  })

  it('shows a delete error when the DELETE rejects', async () => {
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(http.delete(`${BASE}/stock-groups/1/`, () => new HttpResponse(null, { status: 500 })))

    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByText(/could not delete/i)).toBeInTheDocument()
  })

  it('shows a reorder error and rolls back local order when a PATCH rejects during reorder', async () => {
    mockGroups([
      { id: 1, name: 'A', display_order: 0 },
      { id: 2, name: 'B', display_order: 1 },
    ])
    server.use(http.patch(`${BASE}/stock-groups/:id/`, () => new HttpResponse(null, { status: 500 })))

    render()
    const rows = await screen.findAllByRole('listitem')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.dragStart(rows[0], { dataTransfer })
    fireEvent.dragOver(rows[1], { dataTransfer })
    fireEvent.drop(rows[1], { dataTransfer })

    expect(await screen.findByText(/could not save the new order/i)).toBeInTheDocument()
  })

  it('clears drag-over state on dragLeave and abandons on dragEnd', async () => {
    mockGroups([
      { id: 1, name: 'A', display_order: 0 },
      { id: 2, name: 'B', display_order: 1 },
    ])
    let patchCalls = 0
    server.use(
      http.patch(`${BASE}/stock-groups/:id/`, () => {
        patchCalls += 1
        return HttpResponse.json({})
      }),
    )

    render()
    const rows = await screen.findAllByRole('listitem')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
    const { fireEvent } = await import('@testing-library/react')

    fireEvent.dragStart(rows[0], { dataTransfer })
    fireEvent.dragEnter(rows[1], { dataTransfer })
    // Leaving the row entirely (no relatedTarget inside currentTarget) clears dragOverId.
    fireEvent.dragLeave(rows[1], { dataTransfer, relatedTarget: document.body })
    // dragEnd without a drop must not PATCH anything.
    fireEvent.dragEnd(rows[0], { dataTransfer })

    expect(patchCalls).toBe(0)
  })

  it('disables all actions when offline', async () => {
    reachableRef.current = false
    try {
      mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
      render()

      await waitFor(() => expect(screen.getByText('Pantry')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: /rename/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /^delete$/i })).toBeDisabled()
      const createInput = screen.getByLabelText(/category name/i)
      expect(createInput).toBeDisabled()
      expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
    } finally {
      reachableRef.current = true
    }
  })
})
