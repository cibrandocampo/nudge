import { useState } from 'react'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import IntervalPicker from '../IntervalPicker'

function render(props = {}) {
  const defaults = { valueHours: 24, onChange: vi.fn() }
  return renderWithProviders(<IntervalPicker {...defaults} {...props} />)
}

describe('IntervalPicker', () => {
  it('renders with Days selected and value 1 for valueHours=24', () => {
    render({ valueHours: 24 })
    const daysTab = screen.getByRole('tab', { name: 'days' })
    expect(daysTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
  })

  it('clicking + emits onChange with the next hours count', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 24, onChange })
    await user.click(screen.getByRole('button', { name: 'Increase' }))
    expect(onChange).toHaveBeenCalledWith(48)
  })

  it('disables the − button when value is already 1', () => {
    render({ valueHours: 24 })
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled()
  })

  it('switching units keeps the numeric value and re-emits hours', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 48, onChange })
    // 48 hours → days=2; click Weeks → 2 weeks = 336h.
    await user.click(screen.getByRole('tab', { name: 'weeks' }))
    expect(onChange).toHaveBeenCalledWith(336)
  })

  it('clamps to the per-unit max when switching to a unit with a smaller cap', async () => {
    const onChange = vi.fn()
    // 29*24 = 696h. Not divisible by week/month/year so hoursToHuman picks
    // days=29. months max = 24 → switching clamps to 24 and emits 24 * 720.
    const { user } = render({ valueHours: 29 * 24, onChange })
    await user.click(screen.getByRole('tab', { name: 'months' }))
    expect(onChange).toHaveBeenCalledWith(24 * 720)
  })

  it('commits the input on blur converting typed value to hours', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 24, onChange })
    const input = screen.getByDisplayValue('1')
    await user.clear(input)
    await user.type(input, '7')
    input.blur()
    expect(onChange).toHaveBeenCalledWith(7 * 24)
  })

  it('commits an invalid draft as 1 on blur', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 72, onChange })
    const input = screen.getByDisplayValue('3')
    await user.clear(input)
    // Only digits reach state; typing "abc" is filtered out to empty.
    await user.type(input, 'abc')
    input.blur()
    expect(onChange).toHaveBeenCalledWith(24)
  })

  it('renders the error message when the error prop is truthy', () => {
    render({ valueHours: 24, error: 'Must be greater than 0.' })
    expect(screen.getByText('Must be greater than 0.')).toBeInTheDocument()
  })

  it('does not re-emit when the same unit tab is clicked again', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 24, onChange })
    await user.click(screen.getByRole('tab', { name: 'days' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not re-emit when a blurred draft matches the current value', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 48, onChange })
    const input = screen.getByDisplayValue('2')
    await user.click(input)
    // Focus sets draft='' → blur with draft='' clamps to 1; value is 2, so emit runs once.
    // Re-focus and blur with the same digits typed as current value → no emit.
    input.blur()
    onChange.mockClear()
    await user.click(input)
    await user.type(input, '1') // draft='1', current value was clamped to 1
    input.blur()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits the input and blurs on Enter', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 24, onChange })
    const input = screen.getByDisplayValue('1')
    await user.click(input)
    await user.type(input, '5{Enter}')
    expect(onChange).toHaveBeenCalledWith(5 * 24)
  })

  it('ignores + clicks that do not change the clamped value', async () => {
    const onChange = vi.fn()
    // months max = 24 → starting at 24 months, + is a no-op.
    const { user } = render({ valueHours: 24 * 720, onChange })
    const plusBtn = screen.getByRole('button', { name: 'Increase' })
    expect(plusBtn).toBeDisabled()
  })

  it('syncs internal state to a new valueHours prop without firing onChange', async () => {
    const onChange = vi.fn()
    function Harness() {
      const [hours, setHours] = useState(24)
      return (
        <>
          <IntervalPicker valueHours={hours} onChange={onChange} />
          <button type="button" onClick={() => setHours(72)}>
            bump
          </button>
        </>
      )
    }
    const { user } = renderWithProviders(<Harness />)
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'bump' }))
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
