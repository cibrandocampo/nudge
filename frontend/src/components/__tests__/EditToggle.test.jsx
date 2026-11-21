import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import EditToggle from '../EditToggle'

function setup(props = {}) {
  const onToggle = vi.fn()
  const onOffline = vi.fn()
  const view = renderWithProviders(
    <EditToggle
      section="Lots"
      editing={false}
      onToggle={onToggle}
      controls="stock-lots"
      reachable
      offlineTitle="Not available offline"
      onOffline={onOffline}
      {...props}
    />,
  )
  return { ...view, onToggle, onOffline }
}

describe('EditToggle', () => {
  it('reads «Edit» at rest, named after its section, and points at the list', () => {
    setup()
    const button = screen.getByRole('button', { name: 'Edit: Lots' })
    expect(button).toHaveTextContent('Edit')
    expect(button).toHaveAttribute('aria-controls', 'stock-lots')
    expect(button).not.toHaveAttribute('aria-pressed')
    expect(button).toHaveAttribute('data-testid', 'edit-toggle')
  })

  it('reads «Done» while editing', () => {
    setup({ editing: true })
    expect(screen.getByRole('button', { name: 'Done: Lots' })).toHaveTextContent('Done')
  })

  it('toggles on a tap', async () => {
    const { user, onToggle } = setup()
    await user.click(screen.getByRole('button', { name: 'Edit: Lots' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('offline at rest it refuses: aria-disabled, the offline title, and onOffline instead of toggling', async () => {
    const { user, onToggle, onOffline } = setup({ reachable: false })
    const button = screen.getByRole('button', { name: 'Edit: Lots' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('title', 'Not available offline')
    await user.click(button)
    expect(onOffline).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('offline while editing it still lets the user leave the mode', async () => {
    const { user, onToggle, onOffline } = setup({ reachable: false, editing: true })
    const button = screen.getByRole('button', { name: 'Done: Lots' })
    expect(button).not.toHaveAttribute('aria-disabled')
    await user.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onOffline).not.toHaveBeenCalled()
  })

  it('takes another test id when a page has two', () => {
    setup({ testId: 'contacts-edit' })
    expect(screen.getByTestId('contacts-edit')).toBeInTheDocument()
  })
})
