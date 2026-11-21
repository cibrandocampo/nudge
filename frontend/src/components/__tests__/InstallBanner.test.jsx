import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: vi.fn(),
}))

import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { __resetForTests, setReachable } from '../../offline/reachability'
import { renderWithProviders } from '../../test/helpers'
import InstallBanner from '../InstallBanner'

function mockHook(overrides = {}) {
  useInstallPrompt.mockReturnValue({
    canInstall: true,
    hasNativePrompt: false,
    platform: 'ios',
    triggerNativePrompt: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
    ...overrides,
  })
}

describe('InstallBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // setReachable(false) starts the health poll; clear it and the state.
    __resetForTests()
  })

  it('renders nothing when canInstall=false', () => {
    mockHook({ canInstall: false })
    renderWithProviders(<InstallBanner />)
    expect(screen.queryByTestId('install-banner')).toBeNull()
  })

  it('gives way to the offline banner while the server is unreachable, and comes back with it', () => {
    mockHook()
    renderWithProviders(<InstallBanner />)
    act(() => setReachable(false))
    expect(screen.queryByTestId('install-banner')).toBeNull()
    act(() => setReachable(true))
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
  })

  it('renders the banner text when canInstall=true', () => {
    mockHook()
    renderWithProviders(<InstallBanner />)
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
    expect(screen.getByText('Install the app for a better experience')).toBeInTheDocument()
  })

  it('calls triggerNativePrompt when hasNativePrompt=true', async () => {
    const trigger = vi.fn().mockResolvedValue({ outcome: 'accepted' })
    mockHook({ hasNativePrompt: true, platform: 'android-chromium', triggerNativePrompt: trigger })

    const { user } = renderWithProviders(<InstallBanner />)
    await user.click(screen.getByTestId('install-banner'))

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the install sheet when hasNativePrompt=false', async () => {
    mockHook({ hasNativePrompt: false, platform: 'ios' })
    const { user } = renderWithProviders(<InstallBanner />)

    await user.click(screen.getByTestId('install-banner'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Add Nudge to your home screen')).toBeInTheDocument()
  })

  it('closing the sheet leaves the banner as it was', async () => {
    mockHook({ hasNativePrompt: false, platform: 'ios' })
    const { user } = renderWithProviders(<InstallBanner />)

    await user.click(screen.getByTestId('install-banner'))
    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('install-banner')).toBeInTheDocument()
  })

  it('its × reports the dismissal to the slot (T155)', async () => {
    mockHook()
    const onDismiss = vi.fn()
    const { user } = renderWithProviders(<InstallBanner onDismiss={onDismiss} />)

    await user.click(screen.getByTestId('install-dismiss'))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('opens the firefox sheet variant for firefox-android platform', async () => {
    mockHook({ hasNativePrompt: false, platform: 'firefox-android' })
    const { user } = renderWithProviders(<InstallBanner />)

    await user.click(screen.getByTestId('install-banner'))

    expect(screen.getByText(/Open the browser menu/)).toBeInTheDocument()
    expect(screen.getByText(/Tap "Install"/)).toBeInTheDocument()
  })

  it('falls back to the sheet when triggerNativePrompt throws', async () => {
    const trigger = vi.fn().mockRejectedValue(new Error('event already consumed'))
    mockHook({ hasNativePrompt: true, platform: 'android-chromium', triggerNativePrompt: trigger })

    const { user } = renderWithProviders(<InstallBanner />)
    await user.click(screen.getByTestId('install-banner'))

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
