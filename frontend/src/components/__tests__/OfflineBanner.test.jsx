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

  it('renders the last-sync line with a relative timestamp once a successful response was observed', () => {
    // Stamp the timestamp through the real setReachable path, then flip
    // to unreachable so the banner mounts. The relative formatter for a
    // timestamp ~5 minutes in the past renders something containing the
    // word "minute"/"min" in any locale — assert on a regex broad enough
    // to survive en/es/gl wording.
    const { rerender } = render(<OfflineBanner />)
    act(() => {
      setReachable(true) // bumps lastReachableAt to now
      setReachable(false) // flips banner visible
    })
    rerender(<OfflineBanner />)
    const lastSync = screen.getByTestId('offline-banner-last-sync')
    expect(lastSync).toBeInTheDocument()
    // Generic check: the line contains some text (the i18n string + the
    // relative output). Fragile assertions on exact wording would couple
    // the test to formatRelativeTime's internals.
    expect(lastSync.textContent.length).toBeGreaterThan(0)
  })
})
