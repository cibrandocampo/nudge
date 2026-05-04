import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import InstallSheet from '../InstallSheet'

describe('InstallSheet', () => {
  it('renders the iOS variant with three steps', () => {
    renderWithProviders(<InstallSheet platform="ios" onClose={() => {}} />)

    expect(screen.getByText('Add Nudge to your home screen')).toBeInTheDocument()
    expect(screen.getByText(/Tap the Share button/)).toBeInTheDocument()
    expect(screen.getByText(/Tap "Add to Home Screen"/)).toBeInTheDocument()
    expect(screen.getByText(/Tap "Add" in the top right/)).toBeInTheDocument()

    const items = screen.getByRole('dialog').querySelectorAll('ol li')
    expect(items).toHaveLength(3)
  })

  it('renders the Android Chromium variant with three steps', () => {
    renderWithProviders(<InstallSheet platform="android-chromium" onClose={() => {}} />)

    expect(screen.getByText(/Open the browser menu/)).toBeInTheDocument()
    expect(screen.getByText(/Tap "Install app"/)).toBeInTheDocument()

    const items = screen.getByRole('dialog').querySelectorAll('ol li')
    expect(items).toHaveLength(3)
  })

  it('renders the Firefox Android variant with three steps', () => {
    renderWithProviders(<InstallSheet platform="firefox-android" onClose={() => {}} />)

    expect(screen.getByText(/Open the browser menu/)).toBeInTheDocument()
    expect(screen.getByText(/Tap "Install"/)).toBeInTheDocument()

    const items = screen.getByRole('dialog').querySelectorAll('ol li')
    expect(items).toHaveLength(3)
  })

  it('renders the generic variant with three steps when platform is unknown', () => {
    renderWithProviders(<InstallSheet platform="other" onClose={() => {}} />)

    expect(screen.getByText('Open your browser menu')).toBeInTheDocument()
    expect(screen.getByText(/Tap "Add to Home Screen" or "Install"/)).toBeInTheDocument()

    const items = screen.getByRole('dialog').querySelectorAll('ol li')
    expect(items).toHaveLength(3)
  })

  it('renders the PWA subtitle in every variant', () => {
    renderWithProviders(<InstallSheet platform="ios" onClose={() => {}} />)
    expect(screen.getByText(/lightweight version of Nudge/)).toBeInTheDocument()
    expect(screen.getByText(/no app store needed/)).toBeInTheDocument()
  })

  it('calls onClose when the backdrop is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<InstallSheet platform="ios" onClose={onClose} />)

    fireEvent.click(screen.getByTestId('install-sheet-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when the sheet body is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<InstallSheet platform="ios" onClose={onClose} />)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose on Escape key', () => {
    const onClose = vi.fn()
    renderWithProviders(<InstallSheet platform="ios" onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    const { user } = renderWithProviders(<InstallSheet platform="ios" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('exposes the correct accessibility attributes', () => {
    renderWithProviders(<InstallSheet platform="ios" onClose={() => {}} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelledBy = dialog.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy)).toHaveTextContent('Add Nudge to your home screen')
  })
})
