import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Toggleable mock — flip ``reachable`` between renders.
const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

import OfflineRouteGuard from '../OfflineRouteGuard'

afterEach(() => {
  reachableRef.current = true
})

function renderGuard(child) {
  return render(
    <MemoryRouter>
      <OfflineRouteGuard>{child}</OfflineRouteGuard>
    </MemoryRouter>,
  )
}

describe('OfflineRouteGuard', () => {
  it('renders children when reachable', () => {
    reachableRef.current = true
    renderGuard(<div data-testid="child">protected content</div>)
    expect(screen.getByTestId('child')).toBeInTheDocument()
    expect(screen.queryByTestId('offline-locked-placeholder')).not.toBeInTheDocument()
  })

  it('renders the placeholder instead of children when not reachable', () => {
    reachableRef.current = false
    renderGuard(<div data-testid="child">protected content</div>)
    expect(screen.getByTestId('offline-locked-placeholder')).toBeInTheDocument()
    expect(screen.queryByTestId('child')).not.toBeInTheDocument()
  })

  it('does not mount children when offline (the throwing child never runs)', () => {
    // If the guard rendered the child even briefly, this throw would
    // bubble up as a render error. The placeholder render proves the
    // child was never instantiated.
    reachableRef.current = false
    function Throwing() {
      throw new Error('child should not render when offline')
    }
    renderGuard(<Throwing />)
    expect(screen.getByTestId('offline-locked-placeholder')).toBeInTheDocument()
  })
})
