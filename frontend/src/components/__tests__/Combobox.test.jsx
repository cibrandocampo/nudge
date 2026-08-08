import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Combobox from '../Combobox'

function renderCombobox(props = {}) {
  const user = userEvent.setup()
  const { onChange: propOnChange, ...rest } = props
  const onChange = propOnChange ?? vi.fn()
  const utils = render(
    <Combobox
      value={rest.value ?? ''}
      options={rest.options ?? ['Apple', 'Banana', 'Cherry']}
      placeholder={rest.placeholder ?? 'Search…'}
      emptyMessage={rest.emptyMessage ?? 'No match'}
      {...rest}
      onChange={onChange}
    />,
  )
  return { ...utils, user, onChange }
}

describe('Combobox', () => {
  it('shows the label of the current value when closed', () => {
    renderCombobox({ value: 'Banana' })
    const input = screen.getByRole('combobox')
    expect(input).toHaveValue('Banana')
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens the listbox and shows all options on click', async () => {
    const { user } = renderCombobox()
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('filters options while typing', async () => {
    const { user } = renderCombobox()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('a')
    const options = screen.getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Apple', 'Banana'])
  })

  it('selects the highlighted option and closes when Enter is pressed', async () => {
    const { user, onChange } = renderCombobox()
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('Banana')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes without calling onChange when Escape is pressed', async () => {
    const { user, onChange } = renderCombobox({ value: 'Apple' })
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // Input returns to the label of the current value
    expect(input).toHaveValue('Apple')
  })

  it('wraps the highlight with ArrowDown/ArrowUp', async () => {
    const { user } = renderCombobox()
    const input = screen.getByRole('combobox')
    await user.click(input)
    // 3 options: 0=Apple, 1=Banana, 2=Cherry. Start at 0.
    await user.keyboard('{ArrowDown}') // → Banana (1)
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Banana')
    await user.keyboard('{ArrowDown}') // → Cherry (2)
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Cherry')
    await user.keyboard('{ArrowDown}') // → Apple (0, wrapped)
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Apple')
    await user.keyboard('{ArrowUp}') // → Cherry (2, wrapped backwards)
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('Cherry')
  })

  it('closes when the user clicks outside without calling onChange', async () => {
    const { user, onChange } = renderCombobox()
    // Render a sibling we can click on
    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.appendChild(outside)
    try {
      await user.click(screen.getByRole('combobox'))
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      await user.click(outside)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      outside.remove()
    }
  })

  it('supports object options via getLabel and getKey', async () => {
    const options = [
      { id: 1, username: 'alice' },
      { id: 2, username: 'bob' },
    ]
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Combobox
        value={null}
        onChange={onChange}
        options={options}
        getLabel={(o) => o.username}
        getKey={(o) => o.id}
        placeholder="Search users"
        emptyMessage="No match"
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('alice')).toBeInTheDocument()
    await user.click(screen.getByText('bob'))
    expect(onChange).toHaveBeenCalledWith(options[1])
  })

  it('shows the empty message when no options match', async () => {
    const { user } = renderCombobox({ emptyMessage: 'Nothing found' })
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('zzz')
    expect(screen.getByText('Nothing found')).toBeInTheDocument()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('ArrowDown on a closed combobox opens it without moving the highlight', async () => {
    const { user } = renderCombobox()
    const input = screen.getByRole('combobox')
    input.focus()
    // Blur to collapse (focus opens by default; we need a "closed+focused-ish" state)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('ArrowUp on a closed combobox is a no-op', async () => {
    const { user } = renderCombobox()
    const input = screen.getByRole('combobox')
    input.focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.keyboard('{ArrowUp}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('click on a disabled combobox does not open the listbox', async () => {
    const { user } = renderCombobox({ disabled: true })
    await user.click(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('clicking a combobox that is already open keeps it open (no-op branch)', async () => {
    const { user } = renderCombobox()
    const input = screen.getByRole('combobox')
    await user.click(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    // Second click on the open input must not throw or close.
    await user.click(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('delegates filtering to the parent when onInputChange is provided', async () => {
    const onInputChange = vi.fn()
    // Parent controls the options list — Combobox must not filter locally.
    const { user } = renderCombobox({
      options: ['alpha', 'beta'],
      onInputChange,
    })
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('z')
    expect(onInputChange).toHaveBeenLastCalledWith('z')
    // Options are rendered as-is despite 'z' not matching — local filter is off.
    const labels = screen.getAllByRole('option').map((o) => o.textContent)
    expect(labels).toEqual(['alpha', 'beta'])
  })

  it('fires onSelect alongside onChange only when an option is picked', async () => {
    const onSelect = vi.fn()
    const { user, onChange } = renderCombobox({ onSelect })
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByText('Cherry'))
    expect(onChange).toHaveBeenCalledWith('Cherry')
    expect(onSelect).toHaveBeenCalledWith('Cherry')
  })
})

// A batch number the product has never seen must be typeable, so the input is
// the value rather than a filter over a closed list.
describe('Combobox — free text', () => {
  function renderFreeText(props = {}) {
    const user = userEvent.setup()
    const onChange = props.onChange ?? vi.fn()
    const onSubmit = props.onSubmit ?? vi.fn((e) => e.preventDefault())
    function Harness() {
      const [value, setValue] = useState(props.value ?? '')
      return (
        <form onSubmit={onSubmit}>
          <Combobox
            allowFreeText
            value={value}
            onChange={(next) => {
              setValue(next)
              onChange(next)
            }}
            onSelect={props.onSelect}
            options={props.options ?? ['LOT-A', 'LOT-B']}
            placeholder="Batch"
            emptyMessage="No match"
          />
        </form>
      )
    }
    const utils = render(<Harness />)
    return { ...utils, user, onChange, onSubmit }
  }

  it('reports every keystroke and keeps what was typed after blur', async () => {
    const { user, onChange } = renderFreeText()
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('NEW-9')

    expect(onChange).toHaveBeenLastCalledWith('NEW-9')
    await user.tab()
    // Closing must not discard a value that exists nowhere else.
    expect(input).toHaveValue('NEW-9')
  })

  it('filters the suggestions by what is typed', async () => {
    const { user } = renderFreeText({ options: ['LOT-A', 'LOT-B', 'OTHER'] })
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('lot')

    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['LOT-A', 'LOT-B'])
  })

  it('fills the input from a picked option, and reports it through both channels', async () => {
    const onSelect = vi.fn()
    const { user, onChange } = renderFreeText({ onSelect })
    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'LOT-B' }))

    expect(screen.getByRole('combobox')).toHaveValue('LOT-B')
    expect(onChange).toHaveBeenCalledWith('LOT-B')
    expect(onSelect).toHaveBeenCalledWith('LOT-B')
  })

  it('picks the highlighted option on Enter without submitting the form', async () => {
    const { user, onSubmit } = renderFreeText()
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByRole('combobox')).toHaveValue('LOT-B')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('lets Enter reach the form once there is nothing to pick', async () => {
    const { user, onSubmit } = renderFreeText()
    await user.click(screen.getByRole('combobox'))
    // A brand-new batch: the list has no match, so Enter is the form's.
    await user.keyboard('BRAND-NEW')
    expect(screen.queryAllByRole('option')).toHaveLength(0)

    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalled()
  })

  it('lets Enter reach the form when the list is closed', async () => {
    const { user, onSubmit } = renderFreeText()
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(onSubmit).toHaveBeenCalled()
  })
})
