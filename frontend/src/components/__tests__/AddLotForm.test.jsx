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
// The batch number and the serial start folded (T049), so a test that types
// into either has to open them first — exactly as a user does.
const revealFields = async (user) => user.click(screen.getByTestId('more-fields'))

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
    await revealFields(user)

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } })
    // `FormField` renders its label as a sibling, so the date input is reached
    // by type — the same way the page spec does it.
    fireEvent.change(container.querySelector('input[type="date"]'), { target: { value: '2027-01-31' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. L4021A'), { target: { value: '  LOT-Z  ' } })
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
    await revealFields(user)

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '4' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. L4021A'), { target: { value: 'LOT-Z' } })
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    // The form is still open, still holding what the user typed, and usable
    // again — the whole point of the promise contract.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add batch' })).toBeEnabled())
    expect(screen.getByPlaceholderText('0')).toHaveValue(4)
    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-Z')
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
    await revealFields(user)

    await user.click(screen.getByPlaceholderText('e.g. L4021A'))
    await user.click(screen.getByRole('option', { name: 'LOT-A' }))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-A')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('lets the keyboard reach a suggestion, and exposes which one is active', async () => {
    const { user } = renderForm()
    await openForm(user)
    await revealFields(user)

    const lotInput = screen.getByPlaceholderText('e.g. L4021A')
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
    await revealFields(user)

    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '1' } })
    const lotInput = screen.getByPlaceholderText('e.g. L4021A')
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

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-S')
    expect(screen.getByTestId('serial-input')).toHaveValue('SN-9')

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

    // One convention across the form: the optional fields say so, the single
    // required one says nothing, and no label smuggles "(optional)" into its
    // own text. Quantity used to carry a bare `*` while the batch number wore
    // "(optional)" baked into the translation — three ways of saying the same
    // thing in four fields.
    // Read the labels directly: the hint is a nested span, so the rendered text
    // is split across nodes and `getByText` would not see it as one string.
    const labels = Array.from(document.querySelectorAll('form label'))
    const texts = labels.map((el) => el.textContent.replace(/\s+/g, ' ').trim())
    expect(texts).toEqual(['Quantity', 'Expiry date · optional', 'Batch ID · optional', 'Serial · optional'])
    // Same rendering for all four, so none can drift into its own register.
    const classes = labels.map((el) => el.className)
    expect(new Set(classes).size).toBe(1)
    // And the serial's label sits outside the control, above it.
    expect(screen.getByTestId('serial-input')).not.toHaveAttribute('aria-label', 'Serial')
  })

  it('offers an example in the placeholders rather than repeating the label', async () => {
    const { user } = renderForm()
    await openForm(user)
    await user.click(screen.getByTestId('more-fields'))

    for (const testid of ['lot-input', 'serial-input']) {
      const input = screen.getByTestId(testid)
      const placeholder = input.getAttribute('placeholder')
      expect(placeholder).toMatch(/^e\.g\. /)
      // The label is already above the control; repeating it below is noise.
      const label = input.closest('div').parentElement.querySelector('label')
      expect(label.textContent).not.toContain(placeholder)
    }
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

    await user.clear(screen.getByTestId('serial-input'))

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

  // ── Save and add another ──────────────────────────────────────────────────
  // Six boxes from the hospital should not mean opening the form six times.

  const saveAnother = (user) => user.click(screen.getByTestId('add-and-another'))

  it('sends the same payload the primary Save would', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '3')
    await user.type(screen.getByPlaceholderText('e.g. L4021A'), 'LOT-Z')
    await saveAnother(user)

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 3, lotNumber: 'LOT-Z' }))
  })

  it('stays open with every value cleared', async () => {
    const { user } = renderForm({ onSubmit: vi.fn().mockResolvedValue(undefined) })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '3')
    await user.type(screen.getByPlaceholderText('e.g. L4021A'), 'LOT-Z')
    await user.type(screen.getByTestId('serial-input'), 'SN-Z')
    await saveAnother(user)

    // Still open — the toggle would be showing instead if it had closed.
    expect(screen.queryByTestId('add-lot-toggle')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('')
    expect(screen.getByTestId('serial-input')).toHaveValue('')
  })

  it('restores the quantity to the product default rather than blanking it', async () => {
    const { user } = renderForm({
      stock: { ...baseStock, default_lot_quantity: 5 },
      onSubmit: vi.fn().mockResolvedValue(undefined),
    })
    await openForm(user)
    expect(screen.getByPlaceholderText('0')).toHaveValue(5)

    await saveAnother(user)
    expect(screen.getByPlaceholderText('0')).toHaveValue(5)
  })

  // The one place the two pieces of state deliberately diverge: values go,
  // visibility stays, so the next box does not need `+ campos` again.
  it('keeps the fields revealed for the next box', async () => {
    const { user } = renderForm({ onSubmit: vi.fn().mockResolvedValue(undefined) })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '1')
    await saveAnother(user)

    expect(screen.getByPlaceholderText('e.g. L4021A')).toBeInTheDocument()
    expect(screen.getByTestId('serial-input')).toBeInTheDocument()
    expect(screen.queryByTestId('more-fields')).not.toBeInTheDocument()
  })

  it('returns focus to the quantity, ready for the next box', async () => {
    const { user } = renderForm({ onSubmit: vi.fn().mockResolvedValue(undefined) })
    await openForm(user)

    await user.type(screen.getByPlaceholderText('0'), '1')
    await saveAnother(user)

    expect(screen.getByPlaceholderText('0')).toHaveFocus()
  })

  // Same contract the primary button honours: a rejection loses nothing.
  it('keeps every typed value when the caller rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'))
    const { user } = renderForm({ onSubmit })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '4')
    await user.type(screen.getByPlaceholderText('e.g. L4021A'), 'LOT-KEEP')
    await saveAnother(user)

    expect(screen.getByPlaceholderText('0')).toHaveValue(4)
    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-KEEP')
  })

  it('is refused by a blocker exactly as Save is', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-DUP' }] },
      onSubmit,
    })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '1')
    await user.type(screen.getByTestId('serial-input'), 'SN-DUP')

    expect(screen.getByTestId('add-and-another')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add batch' })).toBeDisabled()
    await saveAnother(user)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('refuses offline exactly as Save does', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)
    reachableRef.current = false
    // The mock cannot notify like the real `useSyncExternalStore` hook, so the
    // re-render that picks up the new value comes from touching a field —
    // which is also what a user does before submitting.
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '2' } })

    await saveAnother(user)

    expect(await screen.findAllByText(/not available offline/i)).not.toHaveLength(0)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // ── Expiry inherited from the batch that was picked ───────────────────────

  // A product with two batches: one dated, one not.
  const twoBatches = {
    ...baseStock,
    lots: [
      { id: 10, quantity: 3, lot_number: 'LOT-DATED', expiry_date: '2027-03-01', serial_number: '' },
      { id: 11, quantity: 2, lot_number: 'LOT-BARE', expiry_date: null, serial_number: '' },
    ],
  }

  it('fills the expiry and locks it when a batch is picked', async () => {
    const { user } = renderForm({ stock: twoBatches })
    await openForm(user)
    await revealFields(user)

    await user.click(screen.getByPlaceholderText('e.g. L4021A'))
    await user.click(await screen.findByText('LOT-DATED'))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-DATED')
    expect(screen.getByTestId('expiry-input')).toHaveValue('2027-03-01')
    expect(screen.getByTestId('expiry-input')).toHaveAttribute('readonly')
    expect(screen.getByTestId('expiry-lock')).toBeInTheDocument()
  })

  // Picking from the list is an explicit act, so it wins over what was typed.
  it('overwrites a date the user had already typed', async () => {
    const { user } = renderForm({ stock: twoBatches })
    await openForm(user)
    await revealFields(user)

    fireEvent.change(screen.getByTestId('expiry-input'), { target: { value: '2029-12-31' } })
    await user.click(screen.getByPlaceholderText('e.g. L4021A'))
    await user.click(await screen.findByText('LOT-DATED'))

    expect(screen.getByTestId('expiry-input')).toHaveValue('2027-03-01')
  })

  it('unlocks when the batch number is typed in, keeping the date it holds', async () => {
    const { user } = renderForm({ stock: twoBatches })
    await openForm(user)
    await revealFields(user)

    await user.click(screen.getByPlaceholderText('e.g. L4021A'))
    await user.click(await screen.findByText('LOT-DATED'))
    expect(screen.getByTestId('expiry-lock')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('e.g. L4021A'), '-B')

    expect(screen.queryByTestId('expiry-lock')).not.toBeInTheDocument()
    expect(screen.getByTestId('expiry-input')).not.toHaveAttribute('readonly')
    // The date stays: unlocking releases it, it does not discard it.
    expect(screen.getByTestId('expiry-input')).toHaveValue('2027-03-01')
  })

  it('locks nothing when the picked batch has no expiry', async () => {
    const { user } = renderForm({ stock: twoBatches })
    await openForm(user)
    await revealFields(user)

    await user.click(screen.getByPlaceholderText('e.g. L4021A'))
    await user.click(await screen.findByText('LOT-BARE'))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-BARE')
    expect(screen.queryByTestId('expiry-lock')).not.toBeInTheDocument()
    expect(screen.getByTestId('expiry-input')).not.toHaveAttribute('readonly')
  })

  // The date comes off the box; a misprint or a one-digit misread has to stay
  // correctable. Easily broken by wiring the lock to "expiry has a value".
  it('never locks an expiry that came from a scan', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `172806011${'0LOT-SCAN'}`
    const { user } = renderForm({ stock: twoBatches })
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('expiry-input')).toHaveValue('2028-06-01')
    expect(screen.queryByTestId('expiry-lock')).not.toBeInTheDocument()
    expect(screen.getByTestId('expiry-input')).not.toHaveAttribute('readonly')
  })

  it('shows the expiry beside the batch number in the list', async () => {
    const { user } = renderForm({ stock: twoBatches })
    await openForm(user)
    await revealFields(user)

    await user.click(screen.getByPlaceholderText('e.g. L4021A'))

    const dated = (await screen.findByText('LOT-DATED')).closest('[role="option"]')
    expect(dated).toHaveTextContent(/2027/)
    // A batch with no date shows the number alone.
    expect(screen.getByText('LOT-BARE').closest('[role="option"]')).toHaveTextContent('LOT-BARE')
  })

  // The helper's rule, asserted through the component so the wiring is covered
  // as well as the rule.
  it('does not offer a batch whose expiry has already passed', async () => {
    const expired = {
      ...baseStock,
      lots: [
        { id: 10, quantity: 1, lot_number: 'LOT-OLD', expiry_date: '2026-05-01', serial_number: '' },
        { id: 11, quantity: 1, lot_number: 'LOT-OK', expiry_date: '2027-01-01', serial_number: '' },
      ],
    }
    const { user } = renderForm({ stock: expired })
    await openForm(user)
    await revealFields(user)

    await user.click(screen.getByPlaceholderText('e.g. L4021A'))

    expect(await screen.findByText('LOT-OK')).toBeInTheDocument()
    expect(screen.queryByText('LOT-OLD')).not.toBeInTheDocument()
  })

  it('submits the inherited expiry even though the field is locked', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ stock: twoBatches, onSubmit })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '2')
    await user.click(screen.getByPlaceholderText('e.g. L4021A'))
    await user.click(await screen.findByText('LOT-DATED'))
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lotNumber: 'LOT-DATED', expiryDate: '2027-03-01' }))
  })

  // ── Progressive disclosure ────────────────────────────────────────────────
  // Quantity and expiry always; batch number and serial folded until asked for
  // or filled by a scan.

  it('opens on two fields, with the batch number and serial folded', async () => {
    const { user } = renderForm()
    await openForm(user)

    expect(screen.getByPlaceholderText('0')).toBeInTheDocument()
    expect(screen.getByText('Expiry date', { selector: 'label' })).toBeInTheDocument()
    // Absent from the DOM, not merely invisible: nothing unreachable in the
    // tab order or the accessibility tree.
    expect(screen.queryByPlaceholderText('e.g. L4021A')).not.toBeInTheDocument()
    expect(screen.queryByTestId('serial-input')).not.toBeInTheDocument()
  })

  it('reveals both fields on demand, and the control then has nothing left to do', async () => {
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('more-fields'))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toBeInTheDocument()
    expect(screen.getByTestId('serial-input')).toBeInTheDocument()
    expect(screen.queryByTestId('more-fields')).not.toBeInTheDocument()
  })

  it('a scan carrying only a batch number leaves the serial folded', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = '10LOT-ONLY'
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-ONLY')
    expect(screen.queryByTestId('serial-input')).not.toBeInTheDocument()
  })

  // The mirror image, and a real code: GS1 allows AI 21 without AI 10 — a
  // serialised box whose batch is not printed in the DataMatrix.
  it('a scan carrying only a serial leaves the batch number folded', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = '21SN-ONLY'
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('serial-input')).toHaveValue('SN-ONLY')
    expect(screen.queryByPlaceholderText('e.g. L4021A')).not.toBeInTheDocument()
    expect(screen.getByTestId('more-fields')).toBeInTheDocument()
  })

  it('a scan carrying both reveals both', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `10LOT-S${GS}21SN-9`
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-S')
    expect(screen.getByTestId('serial-input')).toHaveValue('SN-9')
    expect(screen.queryByTestId('more-fields')).not.toBeInTheDocument()
  })

  // The one the button does most often in practice.
  it('reveals only what is still folded, one field rather than two', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = '10LOT-ONLY'
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))
    // The batch number is already open; only the serial is left.
    expect(screen.getByTestId('more-fields')).toBeInTheDocument()

    await user.click(screen.getByTestId('more-fields'))
    expect(screen.getByTestId('serial-input')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-ONLY')
    expect(screen.queryByTestId('more-fields')).not.toBeInTheDocument()
  })

  // The trap this whole design exists to avoid: binding visibility to "has a
  // value" makes a field disappear while the user is deleting its contents.
  it('keeps a revealed field on screen when the user empties it', async () => {
    const { user } = renderForm()
    await openForm(user)
    await revealFields(user)

    const lot = screen.getByPlaceholderText('e.g. L4021A')
    await user.type(lot, 'LOT-X')
    await user.clear(lot)

    expect(screen.getByPlaceholderText('e.g. L4021A')).toBeInTheDocument()
    expect(screen.getByTestId('serial-input')).toBeInTheDocument()
  })

  it('folds again when the form is closed and reopened', async () => {
    const { user } = renderForm()
    await openForm(user)
    await revealFields(user)
    expect(screen.getByTestId('serial-input')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await openForm(user)

    expect(screen.queryByTestId('serial-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('more-fields')).toBeInTheDocument()
  })

  // A duplicate always implies the serial has a value, so the field is visible
  // by the general rule — pinned rather than left to inference.
  it('leaves the serial visible while a duplicate blocker is showing', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `10LOT-A${GS}21SN-DUP`
    const { user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-DUP' }] },
    })
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('scan-blocker')).toBeInTheDocument()
    expect(screen.getByTestId('serial-input')).toHaveValue('SN-DUP')
  })

  // ── The serial as a field of its own ──────────────────────────────────────
  // The whole point of the task: the camera is the fast path, not the only one.

  it('sends a serial typed by hand, with no scanner involved', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '1')
    await user.type(screen.getByTestId('serial-input'), 'HAND-TYPED-1')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'HAND-TYPED-1' }))
  })

  it('lets the user edit a scanned serial, and sends the edited value', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = `10LOT-S${GS}21SN-9`
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({ onSubmit })
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))
    expect(screen.getByTestId('serial-input')).toHaveValue('SN-9')

    await user.clear(screen.getByTestId('serial-input'))
    await user.type(screen.getByTestId('serial-input'), 'SN-CORRECTED')
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: 'SN-CORRECTED' }))
  })

  // Same rule the other prefills follow: a scan fills what the code carries and
  // leaves the rest of the form alone.
  it('does not blank a typed serial when the code carries none', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = '10LOT-NOSERIAL'
    const { user } = renderForm()
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByTestId('serial-input'), 'TYPED-FIRST')
    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByPlaceholderText('e.g. L4021A')).toHaveValue('LOT-NOSERIAL')
    expect(screen.getByTestId('serial-input')).toHaveValue('TYPED-FIRST')
  })

  it('blocks a hand-typed serial the product already carries', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-DUP' }] },
      onSubmit,
    })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '1')
    await user.type(screen.getByTestId('serial-input'), 'SN-DUP')

    expect(screen.getByTestId('scan-blocker')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add batch' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // The invariant, stated independently of how the submit arrives: a blocked
  // form never calls `onSubmit`. Clicking cannot reach it — both save buttons
  // are disabled while a blocker is showing, and the test above proves it — so
  // the event is dispatched at the form itself, which is the only way anything
  // (a stray `requestSubmit`, a future refactor that drops the `disabled`)
  // could get past the buttons. The guard is what makes that harmless.
  it('refuses a submit dispatched at the form while a blocker is showing', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { container, user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-DUP' }] },
      onSubmit,
    })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByPlaceholderText('0'), '1')
    await user.type(screen.getByTestId('serial-input'), 'SN-DUP')
    expect(screen.getByTestId('scan-blocker')).toBeInTheDocument()

    fireEvent.submit(container.querySelector('form'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('unblocks as soon as the duplicate is edited away', async () => {
    const { user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: 'SN-DUP' }] },
    })
    await openForm(user)
    await revealFields(user)

    await user.type(screen.getByTestId('serial-input'), 'SN-DUP')
    expect(screen.getByTestId('scan-blocker')).toBeInTheDocument()

    await user.type(screen.getByTestId('serial-input'), 'X')
    expect(screen.queryByTestId('scan-blocker')).not.toBeInTheDocument()
  })

  // Most lots carry no serial at all, so an empty field must not collide with
  // every one of them.
  it('does not treat an empty serial as a duplicate of the lots that have none', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const { user } = renderForm({
      stock: { ...baseStock, lots: [{ id: 10, quantity: 1, lot_number: 'LOT-A', serial_number: '' }] },
      onSubmit,
    })
    await openForm(user)

    await user.type(screen.getByPlaceholderText('0'), '2')
    expect(screen.queryByTestId('scan-blocker')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add batch' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: '' }))
  })

  // 20 is the model's `max_length` and the GS1 AI 21 limit; past it the backend
  // answers 400.
  it('caps the serial at twenty characters', async () => {
    const { user } = renderForm()
    await openForm(user)
    await revealFields(user)

    const input = screen.getByTestId('serial-input')
    expect(input).toHaveAttribute('maxLength', '20')
    await user.type(input, 'A'.repeat(30))
    expect(input).toHaveValue('A'.repeat(20))
  })

  it('keeps the scanner open on an unreadable code', async () => {
    scannerAvailableRef.current = true
    decodedRef.current = 'not-a-gs1-code'
    const { user } = renderForm()
    await openForm(user)

    await user.click(screen.getByTestId('scan-lot'))
    await user.click(await screen.findByRole('button', { name: 'emit' }))

    expect(screen.getByTestId('scanner')).toBeInTheDocument()
    // The form is untouched: an unreadable code fills nothing, so nothing unfolds.
    expect(screen.queryByTestId('serial-input')).not.toBeInTheDocument()
  })
})
