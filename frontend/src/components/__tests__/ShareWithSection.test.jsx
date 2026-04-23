import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import ShareWithSection from '../ShareWithSection'

const CONTACTS = [
  { id: 2, username: 'alice' },
  { id: 3, username: 'bob' },
  { id: 4, username: 'carol' },
]

function render(props = {}) {
  const defaults = {
    value: [],
    onChange: vi.fn(),
    contacts: CONTACTS,
    label: 'Share with',
  }
  return renderWithProviders(<ShareWithSection {...defaults} {...props} />)
}

describe('ShareWithSection', () => {
  it('renders the empty-state copy when nothing is selected yet', () => {
    render({ value: [] })
    expect(screen.getByText(/not shared yet/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /unshare with/i })).not.toBeInTheDocument()
  })

  it('renders a chip with the avatar initial per selected contact', () => {
    render({ value: [2] })
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('A')).toBeInTheDocument()
    // The empty-state copy must be gone.
    expect(screen.queryByText(/not shared yet/i)).not.toBeInTheDocument()
  })

  it('opens the ShareModal and toggles a contact on via onChange', async () => {
    const onChange = vi.fn()
    const { user } = render({ value: [], onChange })
    await user.click(screen.getByRole('button', { name: /^share with/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('alice'))
    expect(onChange).toHaveBeenCalledWith([2])
  })

  it('toggles a contact off from the modal', async () => {
    const onChange = vi.fn()
    const { user } = render({ value: [2], onChange })
    await user.click(screen.getByRole('button', { name: /^share with/i }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByText('alice'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('removes a contact via the chip × button', async () => {
    const onChange = vi.fn()
    const { user } = render({ value: [2, 3], onChange })
    await user.click(screen.getByRole('button', { name: /unshare with alice/i }))
    expect(onChange).toHaveBeenCalledWith([3])
  })

  it('disables the Share with… button when there are no contacts', () => {
    render({ contacts: [], value: [] })
    expect(screen.getByRole('button', { name: /^share with/i })).toBeDisabled()
    expect(screen.getByText(/add contacts from settings/i)).toBeInTheDocument()
  })

  it('respects the external `disabled` prop even with contacts', () => {
    render({ contacts: CONTACTS, value: [], disabled: true })
    expect(screen.getByRole('button', { name: /^share with/i })).toBeDisabled()
  })

  it('closes the modal with Escape without firing onChange', async () => {
    const onChange = vi.fn()
    const { user } = render({ value: [], onChange })
    await user.click(screen.getByRole('button', { name: /^share with/i }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onChange).not.toHaveBeenCalled()
  })
})
