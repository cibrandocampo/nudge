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

  // ── Last-sync second line (T180) ────────────────────────────────────────

  it('does NOT render the last-sync line when no successful response was ever observed', () => {
    // Cold-start offline: __resetForTests cleared the timestamp.
    const { rerender } = render(<OfflineBanner />)
    act(() => {
      setReachable(false)
    })
    rerender(<OfflineBanner />)
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('offline-banner-last-sync')).not.toBeInTheDocument()
  })

  it('renders the last-sync line as "just now" right after a successful response', () => {
    // Stamp the timestamp through the real setReachable path, then flip
    // to unreachable so the banner mounts.
    const { rerender } = render(<OfflineBanner />)
    act(() => {
      setReachable(true) // bumps lastReachableAt to now
      setReachable(false) // flips banner visible
    })
    rerender(<OfflineBanner />)
    expect(screen.getByTestId('offline-banner-last-sync')).toHaveTextContent(/^Last sync just now$/)
  })

  it('renders the last-sync line as time elapsed, never as a due date', () => {
    // A past timestamp once went through the routine due-date formatter
    // and read "Last sync Due now" / "Last sync Overdue by 3h" (T108 QA3).
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      act(() => {
        setReachable(true)
        setReachable(false)
      })
      vi.setSystemTime(Date.now() + 3 * 3_600_000)
      render(<OfflineBanner />)
      expect(screen.getByTestId('offline-banner-last-sync')).toHaveTextContent(/^Last sync 3h ago$/)
    } finally {
      vi.useRealTimers()
    }
  })
})
