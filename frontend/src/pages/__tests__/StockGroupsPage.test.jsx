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

const routes = () => (
  <Routes>
    <Route path="/inventory/groups" element={<StockGroupsPage />} />
    <Route path="/inventory" element={<div>Inventory stub</div>} />
  </Routes>
)

function render() {
  return renderWithProviders(routes(), { initialEntries: ['/inventory/groups'] })
}

beforeEach(() => {
  reachableRef.current = true
})

// Delete and Up/Down only show in the categories' «Edit» mode (T154).
async function editGroups(user) {
  await user.click(await screen.findByRole('button', { name: 'Edit: Categories' }))
}

const ABC = [
  { id: 1, name: 'A', display_order: 0 },
  { id: 2, name: 'B', display_order: 1 },
  { id: 3, name: 'C', display_order: 2 },
]

const names = () => screen.getAllByTestId('group-row').map((row) => row.querySelector('span').textContent)

// A stateful server: each PATCH changes the list the GET serves, sorted by
// `display_order` as the API does. A static GET would replay the old order on
// the refetch after the mutation and undo the move on screen.
function serveGroups(initial) {
  const rows = initial.map((g) => ({ ...g }))
  const patches = []
  server.use(
    http.get(`${BASE}/stock-groups/`, () =>
      HttpResponse.json([...rows].sort((a, b) => a.display_order - b.display_order)),
    ),
    http.patch(`${BASE}/stock-groups/:id/`, async ({ params, request }) => {
      const body = await request.json()
      const id = Number(params.id)
      patches.push({ id, ...body })
      Object.assign(
        rows.find((g) => g.id === id),
        body,
      )
      return HttpResponse.json(rows.find((g) => g.id === id))
    }),
  )
  return patches
}

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
    await user.click(await screen.findByRole('button', { name: 'Rename Pantry' }))
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
    await user.click(await screen.findByRole('button', { name: 'Rename Pantry' }))
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
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Delete Pantry' }))
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
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Delete Pantry' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteCalls).toBe(0)
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
    await user.click(await screen.findByRole('button', { name: 'Rename Pantry' }))
    const input = await screen.findByRole('textbox', { name: /rename/i })
    await user.clear(input)
    await user.type(input, 'Despensa{Enter}')
    expect(await screen.findByText(/could not rename/i)).toBeInTheDocument()
  })

  it('shows a delete error when the DELETE rejects', async () => {
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(http.delete(`${BASE}/stock-groups/1/`, () => new HttpResponse(null, { status: 500 })))

    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Delete Pantry' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByText(/could not delete/i)).toBeInTheDocument()
  })

  it('at rest shows only the rename pencil: no Up/Down, no delete, no drag', async () => {
    mockGroups(ABC)
    render()
    await screen.findByText('A')
    expect(screen.getAllByTestId('group-rename')).toHaveLength(3)
    expect(screen.queryByTestId('move-up')).not.toBeInTheDocument()
    expect(screen.queryByTestId('row-delete')).not.toBeInTheDocument()
    for (const row of screen.getAllByTestId('group-row')) expect(row).not.toHaveAttribute('draggable')
  })

  it('in edit mode every row has Up, Down and a delete named after it', async () => {
    mockGroups(ABC)
    const { user } = render()
    await editGroups(user)
    expect(screen.getByRole('button', { name: 'Move B up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move B down' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete B' })).toBeInTheDocument()
    expect(screen.queryByTestId('group-rename')).not.toBeInTheDocument()
  })

  it('Down swaps a category with the next one and PATCHes only those two', async () => {
    const patches = serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Move A down' }))

    expect(names()).toEqual(['B', 'A', 'C'])
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(Object.fromEntries(patches.map((b) => [b.id, b.display_order]))).toEqual({ 1: 1, 2: 0 })
  })

  it('Up swaps a category with the previous one', async () => {
    const patches = serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Move C up' }))

    expect(names()).toEqual(['A', 'C', 'B'])
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(Object.fromEntries(patches.map((b) => [b.id, b.display_order]))).toEqual({ 2: 2, 3: 1 })
  })

  it('two moves in a row send only the rows each move changes', async () => {
    const patches = serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Move A down' }))
    await user.click(screen.getByRole('button', { name: 'Move A down' }))

    expect(names()).toEqual(['B', 'C', 'A'])
    await waitFor(() => expect(patches).toHaveLength(4))
  })

  it("the first row's Up and the last row's Down stay focusable but do nothing", async () => {
    const patches = serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    const firstUp = screen.getByRole('button', { name: 'Move A up' })
    const lastDown = screen.getByRole('button', { name: 'Move C down' })
    expect(firstUp).toHaveAttribute('aria-disabled', 'true')
    expect(lastDown).toHaveAttribute('aria-disabled', 'true')
    expect(firstUp).not.toBeDisabled()
    await user.click(firstUp)
    await user.click(lastDown)
    expect(names()).toEqual(['A', 'B', 'C'])
    expect(patches).toEqual([])
  })

  it('after a move the focus follows the category to its new row', async () => {
    serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Move A down' }))
    expect(screen.getByRole('button', { name: 'Move A down' })).toHaveFocus()
  })

  it('a move that reaches an end hands the focus to the other button of the same category', async () => {
    serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Move B up' }))
    // B is first now: its Up is unavailable, its Down takes the focus.
    expect(screen.getByRole('button', { name: 'Move B down' })).toHaveFocus()
  })

  it('announces where the moved category landed', async () => {
    serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    const region = screen.getByTestId('move-announcement')
    expect(region).toHaveAttribute('aria-live', 'polite')
    await user.click(screen.getByRole('button', { name: 'Move A down' }))
    expect(region).toHaveTextContent('A moved to position 2 of 3')
  })

  it('reorders with the keyboard alone', async () => {
    serveGroups(ABC)
    const { user } = render()
    await editGroups(user)
    screen.getByRole('button', { name: 'Move C up' }).focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    expect(names()).toEqual(['C', 'A', 'B'])
    // At the top now: Enter on the focused Down would move it back; it is the
    // focused control, so the keyboard user is not stranded.
    expect(screen.getByRole('button', { name: 'Move C down' })).toHaveFocus()
  })

  it('shows a reorder error and goes back to the server order when a PATCH rejects', async () => {
    mockGroups(ABC.slice(0, 2))
    server.use(http.patch(`${BASE}/stock-groups/:id/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = render()
    await editGroups(user)
    await user.click(screen.getByRole('button', { name: 'Move A down' }))

    expect(await screen.findByText(/could not save the new order/i)).toBeInTheDocument()
    expect(names()).toEqual(['A', 'B'])
  })

  it('offline: the categories cannot enter edit mode, and create/rename are disabled', async () => {
    reachableRef.current = false
    try {
      mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
      const { user } = render()

      await waitFor(() => expect(screen.getByText('Pantry')).toBeInTheDocument())
      const edit = screen.getByRole('button', { name: 'Edit: Categories' })
      expect(edit).toHaveAttribute('aria-disabled', 'true')
      await user.click(edit)
      expect(await screen.findAllByText('Requires connection')).not.toHaveLength(0)
      expect(screen.queryByTestId('row-delete')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Rename Pantry' })).toBeDisabled()
      expect(screen.getByLabelText(/category name/i)).toBeDisabled()
      expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
    } finally {
      reachableRef.current = true
    }
  })

  it('«Back» returns to the inventory', async () => {
    mockGroups([])
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: /back to inventory/i }))
    expect(screen.getByText('Inventory stub')).toBeInTheDocument()
  })

  it('leaving the rename field saves the new name', async () => {
    let patchBody = null
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(
      http.patch(`${BASE}/stock-groups/1/`, async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ id: 1, name: patchBody.name, display_order: 0 })
      }),
    )
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Rename Pantry' }))
    const input = await screen.findByRole('textbox', { name: /rename/i })
    await user.clear(input)
    await user.type(input, 'Despensa')
    await user.tab()
    await waitFor(() => expect(patchBody).toEqual({ name: 'Despensa' }))
  })

  it.each([
    ['empty', ''],
    ['unchanged', 'Pantry'],
  ])('a rename left %s sends nothing', async (_, value) => {
    let patchCalls = 0
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    server.use(
      http.patch(`${BASE}/stock-groups/1/`, () => {
        patchCalls += 1
        return HttpResponse.json({})
      }),
    )
    const { user } = render()
    await user.click(await screen.findByRole('button', { name: 'Rename Pantry' }))
    const input = await screen.findByRole('textbox', { name: /rename/i })
    await user.clear(input)
    if (value) await user.type(input, value)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /rename/i })).not.toBeInTheDocument())
    expect(patchCalls).toBe(0)
  })

  it('if the connection drops while editing, the deletes turn unavailable and say why', async () => {
    mockGroups([{ id: 1, name: 'Pantry', display_order: 0 }])
    const { user, rerender } = render()
    await editGroups(user)
    reachableRef.current = false
    rerender(routes())
    const del = screen.getByRole('button', { name: 'Delete Pantry' })
    expect(del).toBeDisabled()
    expect(del).toHaveAttribute('title', 'Requires connection')
  })

  it('shows the categories by display_order, whatever order the list arrives in', async () => {
    // A PATCH success updates its category in the cache in place, leaving the
    // array unsorted: the page must not show the array's order (T154 race).
    mockGroups([
      { id: 2, name: 'B', display_order: 1 },
      { id: 3, name: 'C', display_order: 2 },
      { id: 1, name: 'A', display_order: 0 },
    ])
    render()
    await screen.findByText('A')
    expect(names()).toEqual(['A', 'B', 'C'])
  })
})
