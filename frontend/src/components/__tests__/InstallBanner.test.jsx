import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: vi.fn(),
}))

import { useInstallPrompt } from '../../hooks/useInstallPrompt'
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

  it('renders nothing when canInstall=false', () => {
    mockHook({ canInstall: false })
    renderWithProviders(<InstallBanner />)
    expect(screen.queryByTestId('install-banner')).toBeNull()
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
