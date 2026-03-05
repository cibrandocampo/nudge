import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import DateRangePicker from '../DateRangePicker'

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function renderPicker(props = {}) {
  const onChange = vi.fn()
  const defaults = { dateFrom: daysAgo(15), dateTo: todayStr(), onChange }
  const result = renderWithProviders(<DateRangePicker {...defaults} {...props} />)
  return { ...result, onChange }
}

describe('DateRangePicker', () => {
  it('renders trigger with preset label', () => {
    renderPicker()
    expect(screen.getByRole('button', { name: /Last 15 days/i })).toBeInTheDocument()
  })

  it('opens popover on click', async () => {
    const { user } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
  })

  it('selects a preset and closes', async () => {
    const { user, onChange } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    await user.click(screen.getByText('Last 30 days'))

    expect(onChange).toHaveBeenCalledWith({
      dateFrom: daysAgo(30),
      dateTo: todayStr(),
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('selects "All time" preset', async () => {
    const { user, onChange } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    await user.click(screen.getByText('All time'))

    expect(onChange).toHaveBeenCalledWith({ dateFrom: '', dateTo: '' })
  })

  it('applies custom range', async () => {
    const { user, onChange } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))

    const [fromInput, toInput] = screen.getAllByDisplayValue(/.+/).filter((el) => el.type === 'date')

    // Change "from" date
    await user.clear(fromInput)
    await user.type(fromInput, '2026-01-01')
    await user.clear(toInput)
    await user.type(toInput, '2026-01-31')

    await user.click(screen.getByText('Apply'))

    expect(onChange).toHaveBeenCalledWith({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape without applying', async () => {
    const { user, onChange } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes on click outside without applying', async () => {
    const { user, onChange } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Click outside the popover
    await user.click(document.body)

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows custom date label when no preset matches', () => {
    renderPicker({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    // Should show a formatted range, not a preset name
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toMatch(/jan.*–.*jan/i)
  })

  it('highlights active preset', async () => {
    const { user } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    const btn = screen.getByText('Last 15 days', { selector: '[class*=presetBtn]' })
    expect(btn.className).toMatch(/presetBtnActive/)
  })

  it('shows "All time" label when both dates empty', () => {
    renderPicker({ dateFrom: '', dateTo: '' })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toBe('All time')
  })

  it('shows "..." for missing from/to in custom label', () => {
    renderPicker({ dateFrom: '', dateTo: '2026-01-31' })
    const trigger = screen.getByRole('button')
    expect(trigger.textContent).toMatch(/\.\.\./)
  })

  it('shows all 5 presets', async () => {
    const { user } = renderPicker()
    await user.click(screen.getByRole('button', { name: /Last 15 days/i }))
    expect(screen.getByText('Last 15 days', { selector: '[class*=presetBtn]' })).toBeInTheDocument()
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
    expect(screen.getByText('Last 3 months')).toBeInTheDocument()
    expect(screen.getByText('Last 6 months')).toBeInTheDocument()
    expect(screen.getByText('All time')).toBeInTheDocument()
  })
})
