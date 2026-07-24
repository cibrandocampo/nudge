import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import LogDateModal from '../LogDateModal'

// `YYYY-MM-DDTHH:mm` (datetime-local shape), no timezone suffix.
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

describe('LogDateModal', () => {
  const props = {
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults the input to a present-time local value with a max set', () => {
    renderWithProviders(<LogDateModal {...props} />)
    const input = screen.getByTestId('log-date-input')
    expect(input).toHaveAttribute('type', 'datetime-local')
    expect(input.value).toMatch(LOCAL_RE)
    expect(input.getAttribute('max')).toMatch(LOCAL_RE)
  })

  it('calls onConfirm with an ISO/UTC string reflecting the chosen instant', async () => {
    const { user } = renderWithProviders(<LogDateModal {...props} />)
    const input = screen.getByTestId('log-date-input')
    fireEvent.change(input, { target: { value: '2026-07-24T09:00' } })
    await user.click(screen.getByTestId('log-date-confirm'))

    expect(props.onConfirm).toHaveBeenCalledTimes(1)
    const iso = props.onConfirm.mock.calls[0][0]
    // Valid ISO string that round-trips to the picked local wall-clock time.
    expect(new Date(iso).getTime()).toBe(new Date('2026-07-24T09:00').getTime())
  })

  it('does not call onConfirm when the value is cleared', async () => {
    const { user } = renderWithProviders(<LogDateModal {...props} />)
    fireEvent.change(screen.getByTestId('log-date-input'), { target: { value: '' } })
    await user.click(screen.getByTestId('log-date-confirm'))
    expect(props.onConfirm).not.toHaveBeenCalled()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const { user } = renderWithProviders(<LogDateModal {...props} />)
    await user.click(screen.getByText('Cancel'))
    expect(props.onCancel).toHaveBeenCalled()
  })

  it('calls onCancel on Escape key', () => {
    renderWithProviders(<LogDateModal {...props} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onCancel).toHaveBeenCalled()
  })
})
