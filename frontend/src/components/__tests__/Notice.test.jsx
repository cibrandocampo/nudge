import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import Notice from '../Notice'

describe('Notice', () => {
  it('is plain text with no action', () => {
    renderWithProviders(
      <Notice tone="warning" icon="wifi-off" role="status" testId="n">
        Offline
      </Notice>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Offline')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a message with onClick is a button carrying the action test id', async () => {
    const onClick = vi.fn()
    const { user } = renderWithProviders(
      <Notice onClick={onClick} actionTestId="go">
        Go somewhere
      </Notice>,
    )
    await user.click(screen.getByTestId('go'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows a second line when given one', () => {
    renderWithProviders(<Notice detail="Last sync 2 min ago">Offline</Notice>)
    expect(screen.getByText('Last sync 2 min ago')).toBeInTheDocument()
  })
})
