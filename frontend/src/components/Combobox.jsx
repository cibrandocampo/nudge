import { useEffect, useId, useRef, useState } from 'react'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './Combobox.module.css'

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
  disabled = false,
}) {
  const reactId = useId()
  const baseId = id || `combobox-${reactId}`
  const listId = `${baseId}-list`
  const optionId = (index) => `${listId}-opt-${index}`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const wrapRef = useRef(null)

  const normalizedQuery = query.toLowerCase()
  // When the consumer provides `onInputChange` it owns the filtering (e.g.
  // results come from a remote search endpoint) — render options as-is.
  const filtered =
    onInputChange || !query
      ? options.slice(0, maxResults)
      : options.filter((o) => String(getLabel(o)).toLowerCase().includes(normalizedQuery)).slice(0, maxResults)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    setHighlightedIndex(0)
  }, [query, open])

  const inputValue = open ? query : value != null && value !== '' ? String(getLabel(value)) : ''

  const selectOption = (option) => {
    onChange?.(option)
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
      if (!open || filtered.length === 0) return
      e.preventDefault()
      const idx = Math.min(highlightedIndex, filtered.length - 1)
      selectOption(filtered[idx])
    } else if (e.key === 'Escape') {
      if (!open) return
      e.preventDefault()
      setOpen(false)
      setQuery('')
    }
  }

  const activeDescendantId =
    open && filtered.length > 0 && highlightedIndex < filtered.length ? optionId(highlightedIndex) : undefined

  return (
    <div className={s.wrap} ref={wrapRef}>
      <input
        type="text"
        className={cx(shared.input, s.input)}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendantId}
        autoComplete="off"
        placeholder={placeholder}
        value={inputValue}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
          setQuery(next)
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
