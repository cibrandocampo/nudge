import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../hooks/useInstallPrompt', () => ({ useInstallPrompt: vi.fn() }))

import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { renderWithProviders } from '../../test/helpers'
import PendingActions from '../PendingActions'

let pushStatus

function mockState({ install = {}, push = {} } = {}) {
  useInstallPrompt.mockReturnValue({
    canInstall: true,
    platform: 'android-chromium',
    triggerNativePrompt: vi.fn().mockResolvedValue({ outcome: 'accepted' }),
    waitForNativePrompt: vi.fn().mockResolvedValue(false),
    ...install,
  })
  pushStatus = { permission: 'default', subscribed: false, checked: true, ...push }
}

const done = { permission: 'granted', subscribed: true, checked: true }
const installed = { canInstall: false, platform: 'other' }

describe('PendingActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'Notification', {
      value: { permission: 'default' },
      writable: true,
      configurable: true,
    })
  })

  it('renders nothing with everything done', () => {
    mockState({ install: installed, push: done })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.queryByTestId('pending-actions')).toBeNull()
  })

  it('lists both actions, each with what is at risk', () => {
    mockState()
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByTestId('pending-install')).toHaveTextContent('reminders may arrive late or not at all')
    expect(screen.getByTestId('pending-push')).toHaveTextContent("Nudge can't tell you when a routine")
  })

  it('does not ask for notifications while a granted subscription is still being read', () => {
    mockState({ install: installed, push: { permission: 'granted', subscribed: false, checked: false } })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.queryByTestId('pending-actions')).toBeNull()
  })

  it('asks to subscribe when permission is granted but there is no subscription', () => {
    mockState({ install: installed, push: { permission: 'granted', subscribed: false, checked: true } })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByTestId('pending-push')).toBeInTheDocument()
  })

  it('does not count notifications where the browser cannot do them', () => {
    delete window.Notification
    mockState({ install: installed })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.queryByTestId('pending-actions')).toBeNull()
  })

  it('on plain HTTP notifications still count, explained, with no button that cannot work', () => {
    delete window.Notification
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    mockState({ install: installed })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    delete window.isSecureContext
    expect(screen.getByTestId('pending-push')).toHaveTextContent('secure connection (HTTPS)')
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  it('on Android the install risk does not mention iPhone', () => {
    mockState()
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByTestId('pending-install')).not.toHaveTextContent('iPhone')
  })

  it('on iPhone the install risk says reminders will not arrive', () => {
    mockState({ install: { platform: 'ios' } })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByTestId('pending-install')).toHaveTextContent("On iPhone, you won't get reminders")
  })

  it('«Turn on» runs the activation in one tap', async () => {
    const onEnablePush = vi.fn()
    mockState({ install: installed })
    const { user } = renderWithProviders(<PendingActions pushStatus={pushStatus} onEnablePush={onEnablePush} />)
    await user.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(onEnablePush).toHaveBeenCalledTimes(1)
  })

  it('«Turn on» is disabled offline', () => {
    mockState({ install: installed })
    renderWithProviders(<PendingActions pushStatus={pushStatus} disabled />)
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled()
  })

  it('shows progress while activating', () => {
    mockState({ install: installed })
    renderWithProviders(<PendingActions pushStatus={pushStatus} pushLoading />)
    expect(screen.getByRole('button', { name: '…' })).toBeDisabled()
  })

  it('blocked: explains how to allow them, with no button that cannot work', () => {
    mockState({ install: installed, push: { permission: 'denied' } })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByTestId('pending-push')).toHaveTextContent('blocked in your browser')
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  it('iPhone: notifications wait for the install', () => {
    delete window.Notification
    mockState({ install: { platform: 'ios' } })
    renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByTestId('pending-push')).toHaveTextContent('Install the app first')
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  it('«Install» opens the browser dialog when it offers one', async () => {
    const trigger = vi.fn().mockResolvedValue({ outcome: 'accepted' })
    mockState({ install: { triggerNativePrompt: trigger, waitForNativePrompt: vi.fn().mockResolvedValue(true) } })
    const { user } = renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(trigger).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('«Install» opens the instructions when the browser offers no dialog', async () => {
    mockState({ install: { platform: 'ios' } })
    const { user } = renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Add Nudge to your home screen')
  })

  it('falls back to the instructions when the dialog fails', async () => {
    const trigger = vi.fn().mockRejectedValue(new Error('event already consumed'))
    mockState({ install: { triggerNativePrompt: trigger, waitForNativePrompt: vi.fn().mockResolvedValue(true) } })
    const { user } = renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a second tap while the dialog is opening does not fire it twice', async () => {
    let settle
    const trigger = vi.fn(() => new Promise((resolve) => (settle = resolve)))
    mockState({ install: { triggerNativePrompt: trigger, waitForNativePrompt: vi.fn().mockResolvedValue(true) } })
    const { user } = renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    await user.click(screen.getByRole('button', { name: 'Install' }))
    await user.click(screen.getByRole('button', { name: 'Install' }))
    expect(trigger).toHaveBeenCalledTimes(1)
    await act(async () => settle({ outcome: 'dismissed' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the instructions stay open even if the install stops being pending', async () => {
    mockState({ push: done })
    const { user, rerender } = renderWithProviders(<PendingActions pushStatus={pushStatus} />)
    await user.click(screen.getByRole('button', { name: 'Install' }))
    mockState({ install: installed, push: done })
    rerender(<PendingActions pushStatus={pushStatus} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
