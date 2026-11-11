import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import IconChip from '../IconChip'

describe('IconChip', () => {
  it('its text is the accessible name while folded', () => {
    render(<IconChip icon="car" label="May affect driving" />)
    const chip = screen.getByRole('button', { name: 'May affect driving' })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    expect(chip.querySelector('use')).toHaveAttribute('href', '#i-car')
  })

  it('a tap unfolds it and another folds it again', async () => {
    const user = userEvent.setup()
    render(<IconChip icon="car" label="May affect driving" />)
    const chip = screen.getByRole('button', { name: 'May affect driving' })
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps the caller tone class and passes other props through', () => {
    render(<IconChip icon="truck" label="Supply problem" className="tone" data-testid="chip" data-tone="danger" />)
    const chip = screen.getByTestId('chip')
    expect(chip).toHaveClass('tone')
    expect(chip).toHaveAttribute('data-tone', 'danger')
  })
})
