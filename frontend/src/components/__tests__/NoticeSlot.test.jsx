import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import NoticeSlot from '../NoticeSlot'

const state = { reachable: true, entries: [], count: 0 }

vi.mock('../../hooks/useServerReachable', () => ({ useServerReachable: () => state.reachable }))
vi.mock('../../hooks/useQueueEntries', () => ({ useQueueEntries: () => state.entries }))
vi.mock('../../hooks/usePendingActions', () => ({ usePendingActions: () => ({ count: state.count }) }))

function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().hash}</p>
}

function setup(overrides = {}, path = '/') {
  Object.assign(state, overrides)
  return renderWithProviders(
    <>
      <NoticeSlot />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
    { initialEntries: [path] },
  )
}

// What the slot shows, by test id: exactly one notice or none.
const shown = () => ['offline-banner', 'notice-sync-errors', 'notice-pending'].filter((id) => screen.queryByTestId(id))

beforeEach(() => {
  Object.assign(state, { reachable: true, entries: [], count: 0 })
})

describe('NoticeSlot', () => {
  it('shows nothing when there is nothing to say', () => {
    setup()
    expect(shown()).toEqual([])
  })

  it('offline wins over everything else', () => {
    setup({ reachable: false, entries: [{ id: 'e', status: 'error' }], count: 2 })
    expect(shown()).toEqual(['offline-banner'])
  })

  it('changes that could not be saved come next', () => {
    setup({ entries: [{ id: 'e', status: 'error' }], count: 2 })
    expect(shown()).toEqual(['notice-sync-errors'])
  })

  it('then the pending actions, saying how many are left', () => {
    setup({ count: 2 })
    expect(shown()).toEqual(['notice-pending'])
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('2 pending actions')
  })

  it('the pending-actions notice cannot be closed', () => {
    setup({ count: 1 })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.getByTestId('notice-pending')).toHaveTextContent('1 pending action')
  })

  it('leads to the pending actions in Settings', async () => {
    const { user } = setup({ count: 1 })
    await user.click(screen.getByTestId('notice-pending-action'))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#pending')
  })

  it.each(['/settings', '/settings#push'])('is not repeated on %s, where the list already is', (path) => {
    setup({ count: 2 }, path)
    expect(shown()).toEqual([])
  })

  it('waiting changes are not a notice: the header badge has them', () => {
    setup({
      entries: [
        { id: 'a', status: 'pending' },
        { id: 'b', status: 'syncing' },
      ],
    })
    expect(shown()).toEqual([])
  })

  it('counts the changes that could not be saved, and opens the pending panel', async () => {
    const opened = vi.fn()
    window.addEventListener('open-pending-badge', opened)
    try {
      const { user } = setup({
        entries: [
          { id: 'a', status: 'error' },
          { id: 'b', status: 'error' },
          { id: 'c', status: 'pending' },
        ],
      })
      const notice = screen.getByTestId('notice-sync-errors')
      expect(notice).toHaveTextContent('2 changes could not be saved · Review')
      await user.click(screen.getByRole('button', { name: /could not be saved/ }))
      expect(opened).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('open-pending-badge', opened)
    }
  })

  it('sticks under the header as one element', () => {
    const { container } = setup({ count: 1 })
    const slot = container.querySelector('[data-testid="notice-pending"]').parentElement
    expect(slot.className).toMatch(/slot/)
  })
})
