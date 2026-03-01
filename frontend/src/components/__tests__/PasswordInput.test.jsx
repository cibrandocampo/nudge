import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import PasswordInput from '../PasswordInput'

describe('PasswordInput', () => {
  it('renders as password type by default', () => {
    renderWithProviders(<PasswordInput placeholder="Password" value="" onChange={() => {}} />)
    expect(screen.getByPlaceholderText('Password')).toHaveAttribute('type', 'password')
  })

  it('toggles to text type when eye button clicked', async () => {
    const { user } = renderWithProviders(
      <PasswordInput placeholder="Password" value="" onChange={() => {}} />,
    )
    const input = screen.getByPlaceholderText('Password')
    const toggle = screen.getByRole('button')

    expect(input).toHaveAttribute('type', 'password')
    await user.click(toggle)
    expect(input).toHaveAttribute('type', 'text')
  })

  it('toggles back to password type on second click', async () => {
    const { user } = renderWithProviders(
      <PasswordInput placeholder="Password" value="" onChange={() => {}} />,
    )
    const toggle = screen.getByRole('button')

    await user.click(toggle)
    await user.click(toggle)
    expect(screen.getByPlaceholderText('Password')).toHaveAttribute('type', 'password')
  })

  it('toggle button has correct aria-label when hidden', () => {
    renderWithProviders(<PasswordInput placeholder="Password" value="" onChange={() => {}} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Show password')
  })

  it('toggle button has correct aria-label when visible', async () => {
    const { user } = renderWithProviders(
      <PasswordInput placeholder="Password" value="" onChange={() => {}} />,
    )
    await user.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Hide password')
  })

  it('calls onChange when typing', async () => {
    const onChange = vi.fn()
    const { user } = renderWithProviders(
      <PasswordInput placeholder="Password" value="" onChange={onChange} />,
    )
    await user.type(screen.getByPlaceholderText('Password'), 'a')
    expect(onChange).toHaveBeenCalled()
  })
})
