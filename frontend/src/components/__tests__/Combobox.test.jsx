import { render, screen } from '@testing-library/react'
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
})
