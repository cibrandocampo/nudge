import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../offline/sync', () => ({ forceSync: vi.fn() }))

import { __resetForTests, setReachable } from '../../offline/reachability'
import OfflineBanner from '../OfflineBanner'

describe('OfflineBanner', () => {
  afterEach(() => {
    __resetForTests()
  })

  it('renders nothing when the server is reachable', () => {
    const { container } = render(<OfflineBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the banner after flipping to unreachable', () => {
    const { rerender } = render(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()

    act(() => {
      setReachable(false)
    })
    rerender(<OfflineBanner />)

    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
  })

  it('disappears again when the server becomes reachable', () => {
    const { rerender } = render(<OfflineBanner />)
    act(() => {
      setReachable(false)
    })
    rerender(<OfflineBanner />)
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()

    act(() => {
      setReachable(true)
    })
    rerender(<OfflineBanner />)
    expect(screen.queryByTestId('offline-banner')).not.toBeInTheDocument()
  })
})
