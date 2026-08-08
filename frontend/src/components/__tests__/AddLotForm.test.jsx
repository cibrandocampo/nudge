import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import AddLotForm from '../AddLotForm'

const reachableRef = { current: true }
vi.mock('../../hooks/useServerReachable', () => ({
  useServerReachable: () => reachableRef.current,
}))

const scannerAvailableRef = { current: false }
vi.mock('../../hooks/useScannerAvailable', () => ({
  useScannerAvailable: () => scannerAvailableRef.current,
}))

// The real modal needs a camera and a WebAssembly decoder, neither of which
// jsdom has. This stub exposes the two things the form talks to it about:
// a decoded payload and a close.
const decodedRef = { current: '' }
vi.mock('../BarcodeScannerModal', () => ({
  default: ({ onDecoded, onClose }) => (
    <div data-testid="scanner">
      <button type="button" onClick={() => onDecoded(decodedRef.current)}>
        emit
      </button>
      <button type="button" onClick={onClose}>
        close scanner
      </button>
    </div>
  ),
}))

const today = new Date('2026-06-01')

// GS terminates a variable-length AI (10 lot, 21 serial). Without it the
// field runs to the end of the payload — see utils/__tests__/gs1.test.js.
const GS = '\u001d'

const baseStock = {
  id: 1,
  name: 'Water filter',
  default_lot_quantity: null,
  lots: [{ id: 10, quantity: 3, expiry_date: null, lot_number: 'LOT-A', serial_number: '' }],
}

function renderForm(overrides = {}) {
  const props = { stock: baseStock, today, onSubmit: vi.fn().mockResolvedValue(undefined), ...overrides }
  const utils = renderWithProviders(<AddLotForm {...props} />)
  return { ...utils, props, user: userEvent.setup() }
}

const openForm = async (user) => user.click(screen.getByTestId('add-lot-toggle'))

beforeEach(() => {
  reachableRef.current = true
  scannerAvailableRef.current = false
  decodedRef.current = ''
})

describe('AddLotForm', () => {
  it('rests as a single button and opens the fields on click', async () => {
    const { user } = renderForm()

    expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument()
    await openForm(user)

    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()
    expect(screen.queryByTestId('add-lot-toggle')).not.toBeInTheDocument()
  })

  it('starts the quantity from the product default, so the common case is a confirmation', async () => {
    const { user } = renderForm({ stock: { ...baseStock, default_lot_quantity: 30 } })
    await openForm(user)

    expect(screen.getByPlaceholderText('0')).toHaveValue(30)
  })

  it('hands the caller the typed values as a payload', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user, container } = renderForm({ onSubmit })
    await openForm(user)

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } })
    // `FormField` renders its label as a sibling, so the date input is reached
    // by type — the same way the page spec does it.
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2027-01-31' } })
    fireEvent.change(screen.getByPlaceholderText('Batch ID (optional)'), { target: { value: '  LOT-Z  ' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 4,
        expiryDate: '2027-01-31',
        // Trimmed here so the caller never has to think about it.
        lotNumber: 'LOT-Z',
        serialNumber: '',
        rawScan: '',
        parsed: null,
      }),
    )
  })

  it('clears itself and collapses when the caller resolves', async () => {
    const { user } = renderForm()
    await openForm(user)
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    await waitFor(() => expect(screen.getByTestId('add-lot-toggle')).toBeInTheDocument())
    // Reopening starts clean, not from the previous lot.
    await openForm(user)
    expect(screen.getByPlaceholderText('0')).toHaveValue(null)
  })

  it('keeps every typed value when the caller rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('boom'))
    const { user } = renderForm({ onSubmit })
    await openForm(user)

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } })
    fireEvent.change(screen.getByPlaceholderText('Batch ID (optional)'), { target: { value: 'LOT-Z' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    // The form is still open, still holding what the user typed, and usable
    // again — the whole point of the promise contract.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add batch' })).toBeEnabled())
    expect(screen.getByPlaceholderText('0')).toHaveValue(4)
    expect(screen.getByPlaceholderText('Batch ID (optional)')).toHaveValue('LOT-Z')
    expect(screen.queryByTestId('add-lot-toggle')).not.toBeInTheDocument()
  })

  it('disables both actions while the submission is in flight', async () => {
    let release
    const onSubmit = vi.fn(() => new Promise((resolve) => (release = resolve)))
    const { user } = renderForm({ onSubmit })
    await openForm(user)
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    release()
    await waitFor(() => expect(screen.getByTestId('add-lot-toggle')).toBeInTheDocument())
  })

  it('discards the draft on cancel', async () => {
    const { user } = renderForm()
    await openForm(user)
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '7' } })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await openForm(user)
    expect(screen.getByPlaceholderText('0')).toHaveValue(null)
  })

  it('refuses to open while the server is unreachable', async () => {
    reachableRef.current = false
    const { user } = renderForm()

    await user.click(screen.getByTestId('add-lot-toggle'))

    expect(screen.queryByPlaceholderText('0')).not.toBeInTheDocument()
    expect(await screen.findAllByText(/not available offline/i)).not.toHaveLength(0)
  })

  it('refuses to submit when the network drops with the form already open', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)
    reachableRef.current = false
    // The real hook is a `useSyncExternalStore` and notifies its subscribers;
    // the mock cannot, so the re-render that picks up the new value comes from
    // touching a field — which is also what a user does before submitting.
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(await screen.findAllByText(/not available offline/i)).not.toHaveLength(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('suggests the batch IDs the product already has, and fills the field on pick', async () => {
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByPlaceholderText('Batch ID (optional)'))
    await user.click(screen.getByRole('option', { name: 'LOT-A' }))

    expect(screen.getByPlaceholderText('Batch ID (optional)')).toHaveValue('LOT-A')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('lets the keyboard reach a suggestion, and exposes which one is active', async () => {
    const { user } = renderForm()
    await openForm(user)

    const lotInput = screen.getByPlaceholderText('Batch ID (optional)')
    await user.click(lotInput)
    await user.keyboard('{ArrowDown}')
    // The hand-rolled dropdown this replaced had neither of these.
    expect(lotInput).toHaveAttribute('aria-activedescendant', expect.stringContaining('opt-0'))

    await user.keyboard('{Enter}')
    expect(lotInput).toHaveValue('LOT-A')
  })

  it('accepts a batch number the product has never seen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
    const lotInput = screen.getByPlaceholderText('Batch ID (optional)')
    await user.click(lotInput)
    await user.keyboard('BRAND-NEW')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lotNumber: 'BRAND-NEW' }))
  })

  it('offers the scanner only where a camera is available', async () => {
    const { user } = renderForm()
    await openForm(user)
    expect(screen.queryByTestId('scan-lot')).not.toBeInTheDocument()

    scannerAvailableRef.current = true
    const second = renderForm()
    await openForm(second.user)
    expect(screen.getByTestId('scan-lot')).toBeInTheDocument()
  })

  it('fills the fields from a scan and carries the serial and raw payload to the caller', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `10LOT-S${GS}21SN-9`
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByPlaceholderText('Batch ID (optional)')).toHaveValue('LOT-S')
    expect(screen.getByTestId('serial-chip')).toHaveTextContent('SN-9')

    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        lotNumber: 'LOT-S',
        serialNumber: 'SN-9',
        rawScan: decodedRef.current,
        parsed: expect.objectContaining({ lotNumber: 'LOT-S', serialNumber: 'SN-9' }),
      }),
    )
  })

  // The serial used to carry its label inline inside the chip while quantity,
  // expiry and lot number all carried theirs above the control — the one field
  // in this form that read differently from its neighbours. Manual QA on a real
  // device is what caught it, so it gets an assertion rather than a promise.
  it('labels the serial above the control, like every other field', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `10LOT-S${GS}21SN-9`
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    const labels = ['Quantity *', 'Expiry date', 'Batch ID (optional)', 'Serial'].map((text) =>
      screen.getByText(text, { selector: 'label' }),
    )
    // Same rendering for all four, so none can drift into its own register.
    const classes = labels.map((el) => el.className)
    expect(new Set(classes).size).toBe(1)
    // And the serial's label sits outside the chip, above it.
    expect(screen.getByTestId('serial-chip')).not.toHaveTextContent('Serial')
  })

  it('blocks a pack already registered in this stock, and unblocks when the serial is dropped', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `10LOT-A${GS}21SN-DUP`
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-DUP' }] },
      onSubmit,
    })
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('scan-blocker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add batch' })).toBeDisabled()

    await user.click(screen.getByTestId('serial-clear'))

    expect(screen.queryByTestId('scan-blocker')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add batch' })).toBeEnabled()
  })

  it('blocks a box whose expiry has already passed', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `17250101${'10LOT-OLD'}`
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('scan-blocker')).toHaveTextContent(/expired/i)
    expect(screen.getByRole('button', { name: 'Add batch' })).toBeDisabled()
  })

  it('keeps the scanner open on an unreadable code', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = 'not-a-gs1-code'
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('scanner')).toBeInTheDocument()
    expect(screen.queryByTestId('serial-chip')).not.toBeInTheDocument()
  })
})
