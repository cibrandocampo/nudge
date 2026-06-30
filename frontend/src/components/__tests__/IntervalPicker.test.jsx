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
    expect(screen.getByRole('combobox')).toHaveValue('days')
    expect(screen.getByDisplayValue('1')).toBeInTheDocument()
  })

  it('switching units keeps the numeric value and re-emits hours', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 48, onChange })
    // 48 hours → days=2; pick Weeks → 2 weeks = 336h.
    await user.selectOptions(screen.getByRole('combobox'), 'weeks')
    expect(onChange).toHaveBeenCalledWith(336)
  })

  it('clamps to the per-unit max when switching to a unit with a smaller cap', async () => {
    const onChange = vi.fn()
    // 29*24 = 696h. Not divisible by week/month/year so hoursToHuman picks
    // days=29. months max = 24 → switching clamps to 24 and emits 24 * 720.
    const { user } = render({ valueHours: 29 * 24, onChange })
    await user.selectOptions(screen.getByRole('combobox'), 'months')
    expect(onChange).toHaveBeenCalledWith(24 * 720)
  })

  it('does not re-emit when the already-selected unit is chosen again', async () => {
    const onChange = vi.fn()
    const { user } = render({ valueHours: 24, onChange })
    await user.selectOptions(screen.getByRole('combobox'), 'days')
    expect(onChange).not.toHaveBeenCalled()
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

  it('clamps a typed value above the unit max down to the cap on blur', async () => {
    const onChange = vi.fn()
    // days cap = 730. Typing 999 clamps to 730 → 730 * 24 hours.
    const { user } = render({ valueHours: 24, onChange })
    const input = screen.getByDisplayValue('1')
    await user.clear(input)
    await user.type(input, '999')
    input.blur()
    expect(onChange).toHaveBeenCalledWith(730 * 24)
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
