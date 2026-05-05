import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'

vi.mock('../../utils/forceReload', () => ({ forceReload: vi.fn() }))

import { forceReload } from '../../utils/forceReload'
import { publishRemoteVersion } from '../../contexts/appVersionBridge'
import { AppVersionProvider } from '../../contexts/AppVersionContext'
import AutoUpdater from '../AutoUpdater'

function NavBar() {
  const navigate = useNavigate()
  return (
    <div>
      <button onClick={() => navigate('/')}>nav-home</button>
      <button onClick={() => navigate('/inventory')}>nav-inventory</button>
      <button onClick={() => navigate('/history')}>nav-history</button>
      <button onClick={() => navigate('/settings')}>nav-settings</button>
      <button onClick={() => navigate('/routines/abc')}>nav-routine</button>
      <button onClick={() => navigate('/routines/new')}>nav-routine-new</button>
      <button onClick={() => navigate('/inventory/new')}>nav-inv-new</button>
      <button onClick={() => navigate('/inventory/abc')}>nav-inv-detail</button>
      <button onClick={() => navigate('/inventory/abc/edit')}>nav-inv-edit</button>
      <button onClick={() => navigate('/inventory/groups')}>nav-inv-groups</button>
      <button onClick={() => navigate('/login')}>nav-login</button>
    </div>
  )
}

function setup(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <AppVersionProvider>
        <AutoUpdater />
        <Routes>
          <Route path="*" element={<NavBar />} />
        </Routes>
      </AppVersionProvider>
    </MemoryRouter>,
  )
}

describe('AutoUpdater', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_APP_VERSION', '1.0.0')
    forceReload.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not reload when there is no version mismatch', async () => {
    const user = userEvent.setup()
    setup('/')
    await user.click(screen.getByText('nav-inventory'))
    await user.click(screen.getByText('nav-history'))
    expect(forceReload).not.toHaveBeenCalled()
  })

  it.each([
    ['nav-home', '/'],
    ['nav-inventory', '/inventory'],
    ['nav-history', '/history'],
    ['nav-settings', '/settings'],
  ])('reloads when navigating to %s (%s) with a pending update', async (button) => {
    const user = userEvent.setup()
    setup('/routines/abc')
    act(() => {
      publishRemoteVersion('2.0.0')
    })
    expect(forceReload).not.toHaveBeenCalled()
    await user.click(screen.getByText(button))
    expect(forceReload).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['nav-routine', '/routines/abc'],
    ['nav-routine-new', '/routines/new'],
    ['nav-inv-new', '/inventory/new'],
    ['nav-inv-detail', '/inventory/abc'],
    ['nav-inv-edit', '/inventory/abc/edit'],
    ['nav-inv-groups', '/inventory/groups'],
    ['nav-login', '/login'],
  ])('does not reload when navigating to non-safe route %s (%s)', async (button) => {
    const user = userEvent.setup()
    setup('/')
    act(() => {
      publishRemoteVersion('2.0.0')
    })
    forceReload.mockClear() // ignore the initial mount on '/' which already triggered
    await user.click(screen.getByText(button))
    expect(forceReload).not.toHaveBeenCalled()
  })

  it('does not reload when the flag flips while parked on a safe route (no navigation)', () => {
    setup('/inventory')
    expect(forceReload).not.toHaveBeenCalled()
    act(() => {
      publishRemoteVersion('2.0.0')
    })
    expect(forceReload).not.toHaveBeenCalled()
  })

  it('reloads on the next navigation to a safe route after parking on a non-safe one', async () => {
    const user = userEvent.setup()
    setup('/routines/abc')
    act(() => {
      publishRemoteVersion('2.0.0')
    })
    expect(forceReload).not.toHaveBeenCalled()
    await user.click(screen.getByText('nav-inventory'))
    expect(forceReload).toHaveBeenCalledTimes(1)
  })

  it('reloads on every distinct safe-route navigation (effect runs per location.key)', async () => {
    const user = userEvent.setup()
    setup('/routines/abc')
    act(() => {
      publishRemoteVersion('2.0.0')
    })
    await user.click(screen.getByText('nav-inventory'))
    await user.click(screen.getByText('nav-history'))
    await user.click(screen.getByText('nav-home'))
    expect(forceReload).toHaveBeenCalledTimes(3)
  })
})
