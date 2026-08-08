import { useEffect, useId, useRef, useState } from 'react'
import { useClickOutside } from '../hooks/useClickOutside'
import { useEscapeKey } from '../hooks/useEscapeKey'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './Combobox.module.css'

/**
 * A text input with a filtered list of options under it.
 *
 * Two modes, because two different things are called a combobox:
 *
 * - **Pick one of these** (default). The value is always one of `options`;
 *   typing only filters, and what was typed is discarded on close. This is what
 *   choosing a contact or a stock group needs.
 * - **Free text with suggestions** (`allowFreeText`). The input *is* the value:
 *   every keystroke reaches `onChange`, and the list is a shortcut, not a
 *   constraint. A batch number the product has never seen must be typeable.
 *
 * `onSelect` fires only when an option is chosen from the list, in addition to
 * `onChange` — a side-channel for callers that need to react to the choice
 * itself rather than to the resulting text.
 */
export default function Combobox({
  value,
  onChange,
  options,
  placeholder,
  getLabel = (o) => o,
  getKey = (o) => o,
  emptyMessage,
  maxResults = 50,
  id,
  onInputChange,
  onSelect,
  allowFreeText = false,
  inputClassName,
  disabled = false,
  ...rest
}) {
  const reactId = useId()
  const baseId = id || `combobox-${reactId}`
  const listId = `${baseId}-list`
  const optionId = (index) => `${listId}-opt-${index}`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const wrapRef = useRef(null)

  // In free-text mode the value itself is what the user typed, so it is also
  // what filters the list; there is no separate draft to keep.
  const effectiveQuery = allowFreeText ? String(value ?? '') : query
  const normalizedQuery = effectiveQuery.trim().toLowerCase()
  // When the consumer provides `onInputChange` it owns the filtering (e.g.
  // results come from a remote search endpoint) — render options as-is.
  const filtered =
    onInputChange || !normalizedQuery
      ? options.slice(0, maxResults)
      : options.filter((o) => String(getLabel(o)).toLowerCase().includes(normalizedQuery)).slice(0, maxResults)

  useClickOutside(
    wrapRef,
    () => {
      setOpen(false)
      setQuery('')
    },
    open,
  )

  useEscapeKey(() => {
    setOpen(false)
    setQuery('')
  }, open)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [effectiveQuery, open])

  const inputValue = allowFreeText
    ? String(value ?? '')
    : open
      ? query
      : value != null && value !== ''
        ? String(getLabel(value))
        : ''

  const selectOption = (option) => {
    onChange?.(option)
    onSelect?.(option)
    setOpen(false)
    setQuery('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (filtered.length === 0) return
      setHighlightedIndex((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return
      if (filtered.length === 0) return
      setHighlightedIndex((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      // Enter belongs to the list only while the list has something to pick.
      // Otherwise it must reach the surrounding form — in free-text mode the
      // whole point is submitting a value that is not in the list, and
      // swallowing the key would make that impossible.
      if (!open || filtered.length === 0) return
      e.preventDefault()
      const idx = Math.min(highlightedIndex, filtered.length - 1)
      selectOption(filtered[idx])
    }
  }

  const activeDescendantId =
    open && filtered.length > 0 && highlightedIndex < filtered.length ? optionId(highlightedIndex) : undefined

  return (
    <div className={s.wrap} ref={wrapRef}>
      <input
        type="text"
        className={cx(shared.input, s.input, inputClassName)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendantId}
        autoComplete="off"
        placeholder={placeholder}
        value={inputValue}
        disabled={disabled}
        {...rest}
        onChange={(e) => {
          const next = e.target.value
          // Free text: the keystroke is the value, so it goes straight out.
          // Otherwise it is only a filter, kept locally until an option is
          // picked.
          if (allowFreeText) onChange?.(next)
          else setQuery(next)
          if (!open) setOpen(true)
          onInputChange?.(next)
        }}
        onFocus={() => {
          if (disabled || open) return
          setOpen(true)
        }}
        onClick={() => {
          if (disabled || open) return
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul id={listId} role="listbox" className={s.popover}>
          {filtered.length === 0 ? (
            <li className={s.empty}>{emptyMessage}</li>
          ) : (
            filtered.map((option, index) => {
              const highlighted = index === highlightedIndex
              return (
                <li
                  key={getKey(option)}
                  id={optionId(index)}
                  role="option"
                  aria-selected={highlighted}
                  className={cx(s.option, highlighted && s.optionHighlighted)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    selectOption(option)
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  {String(getLabel(option))}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
