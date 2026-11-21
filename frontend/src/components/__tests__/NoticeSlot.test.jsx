import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import NoticeSlot from '../NoticeSlot'

const state = { reachable: true, entries: [], canInstall: false, pushActive: true }

vi.mock('../../hooks/useServerReachable', () => ({ useServerReachable: () => state.reachable }))
vi.mock('../../hooks/useQueueEntries', () => ({ useQueueEntries: () => state.entries }))
vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: () => ({
    canInstall: state.canInstall,
    hasNativePrompt: false,
    platform: 'android',
    triggerNativePrompt: vi.fn(),
  }),
}))
vi.mock('../../hooks/usePushStatus', () => ({ usePushStatus: () => ({ active: state.pushActive }) }))

function Where() {
  return <p data-testid="where">{useLocation().pathname + useLocation().hash}</p>
}

function setup(overrides = {}) {
  Object.assign(state, overrides)
  return renderWithProviders(
    <>
      <NoticeSlot />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
  )
}

// What the slot shows, by test id: exactly one notice or none.
const shown = () =>
  ['offline-banner', 'notice-sync-errors', 'install-notice', 'notice-push-off'].filter((id) => screen.queryByTestId(id))

beforeEach(() => {
  Object.assign(state, { reachable: true, entries: [], canInstall: false, pushActive: true })
  localStorage.removeItem('nudge.installDismissed')
})

describe('NoticeSlot', () => {
  it('shows nothing when there is nothing to say', () => {
    setup()
    expect(shown()).toEqual([])
  })

  it('offline wins over everything else', () => {
    setup({ reachable: false, entries: [{ id: 'e', status: 'error' }], canInstall: true, pushActive: false })
    expect(shown()).toEqual(['offline-banner'])
  })

  it('changes that could not be saved come next', () => {
    setup({ entries: [{ id: 'e', status: 'error' }], canInstall: true, pushActive: false })
    expect(shown()).toEqual(['notice-sync-errors'])
  })

  it('then the install invitation, before the notifications notice', () => {
    setup({ canInstall: true, pushActive: false })
    expect(shown()).toEqual(['install-notice'])
  })

  it('then «notifications are off»', () => {
    setup({ pushActive: false })
    expect(shown()).toEqual(['notice-push-off'])
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

  it('«notifications are off» leads to the push section of Settings', async () => {
    const { user } = setup({ pushActive: false })
    await user.click(screen.getByRole('button', { name: /notifications are off/i }))
    expect(screen.getByTestId('where')).toHaveTextContent('/settings#push')
  })

  it('the install ×, once pressed, keeps it hidden on this device — and the next notice takes the slot', async () => {
    const { user, unmount } = setup({ canInstall: true, pushActive: false })
    await user.click(screen.getByRole('button', { name: 'Dismiss the install suggestion' }))
    expect(shown()).toEqual(['notice-push-off'])
    expect(localStorage.getItem('nudge.installDismissed')).toBe('1')

    unmount()
    setup({ canInstall: true, pushActive: false })
    expect(shown()).toEqual(['notice-push-off'])
  })

  it('sticks under the header as one element', () => {
    const { container } = setup({ pushActive: false })
    const slot = container.querySelector('[data-testid="notice-push-off"]').parentElement
    expect(slot.className).toMatch(/slot/)
  })
})
