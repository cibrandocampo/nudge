import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useInstallPrompt', () => ({
  useInstallPrompt: vi.fn(),
}))

import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { renderWithProviders } from '../../test/helpers'
import InstallCard from '../InstallCard'

function mockHook(overrides = {}) {
  useInstallPrompt.mockReturnValue({
    canInstall: true,
    hasNativePrompt: false,
    platform: 'ios',
    triggerNativePrompt: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
    ...overrides,
  })
}

describe('InstallCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when canInstall=false', () => {
    mockHook({ canInstall: false })
    renderWithProviders(<InstallCard />)
    expect(screen.queryByTestId('install-card')).toBeNull()
  })

  it('renders title, slogan, and explanatory text when canInstall=true', () => {
    mockHook()
    renderWithProviders(<InstallCard />)

    expect(screen.getByText('Install Nudge')).toBeInTheDocument()
    expect(screen.getByText(/Ultra-light install/)).toBeInTheDocument()
    expect(screen.getByText(/installs in 2 taps/)).toBeInTheDocument()
  })

  it('shows iOS-specific CTA label when platform=ios and no native prompt', () => {
    mockHook({ hasNativePrompt: false, platform: 'ios' })
    renderWithProviders(<InstallCard />)

    expect(screen.getByRole('button', { name: 'Add to home screen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Install app' })).toBeNull()
  })

  it('shows generic CTA label when native prompt is available', () => {
    mockHook({ hasNativePrompt: true, platform: 'android-chromium' })
    renderWithProviders(<InstallCard />)

    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument()
  })

  it('shows generic CTA label on non-iOS even without native prompt', () => {
    mockHook({ hasNativePrompt: false, platform: 'firefox-android' })
    renderWithProviders(<InstallCard />)

    expect(screen.getByRole('button', { name: 'Install app' })).toBeInTheDocument()
  })

  it('triggers the native prompt on click when available', async () => {
    const trigger = vi.fn().mockResolvedValue({ outcome: 'accepted' })
    mockHook({ hasNativePrompt: true, platform: 'android-chromium', triggerNativePrompt: trigger })

    const { user } = renderWithProviders(<InstallCard />)
    await user.click(screen.getByRole('button', { name: 'Install app' }))

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the install sheet when no native prompt is available', async () => {
    mockHook({ hasNativePrompt: false, platform: 'ios' })
    const { user } = renderWithProviders(<InstallCard />)

    await user.click(screen.getByRole('button', { name: 'Add to home screen' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Add Nudge to your home screen')).toBeInTheDocument()
  })

  it('falls back to the sheet when triggerNativePrompt throws', async () => {
    const trigger = vi.fn().mockRejectedValue(new Error('event already consumed'))
    mockHook({ hasNativePrompt: true, platform: 'android-chromium', triggerNativePrompt: trigger })

    const { user } = renderWithProviders(<InstallCard />)
    await user.click(screen.getByRole('button', { name: 'Install app' }))

    expect(trigger).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
