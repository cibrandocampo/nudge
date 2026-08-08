import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useFieldDisclosure } from '../useFieldDisclosure'

const NAMES = ['lot', 'serial']
const setup = () => renderHook(() => useFieldDisclosure(NAMES))

describe('useFieldDisclosure', () => {
  it('starts with everything folded', () => {
    const { result } = setup()
    expect(result.current.isRevealed('lot')).toBe(false)
    expect(result.current.isRevealed('serial')).toBe(false)
    expect(result.current.hasHidden).toBe(true)
  })

  it('reveals one field without touching the others', () => {
    const { result } = setup()
    act(() => result.current.reveal('lot'))
    expect(result.current.isRevealed('lot')).toBe(true)
    expect(result.current.isRevealed('serial')).toBe(false)
    expect(result.current.hasHidden).toBe(true)
  })

  it('reveals everything still folded, and then has nothing hidden', () => {
    const { result } = setup()
    act(() => result.current.revealAll())
    expect(result.current.isRevealed('lot')).toBe(true)
    expect(result.current.isRevealed('serial')).toBe(true)
    expect(result.current.hasHidden).toBe(false)
  })

  // The count is read when the control is pressed, not assumed to be two.
  it('leaves an already-revealed field alone when revealing the rest', () => {
    const { result } = setup()
    act(() => result.current.reveal('lot'))
    act(() => result.current.revealAll())
    expect(result.current.isRevealed('lot')).toBe(true)
    expect(result.current.isRevealed('serial')).toBe(true)
  })

  // Revealing is one-way while the form is open: nothing folds a field the
  // user can already see.
  it('never folds a field except on reset', () => {
    const { result } = setup()
    act(() => result.current.reveal('serial'))
    act(() => result.current.reveal('serial'))
    expect(result.current.isRevealed('serial')).toBe(true)

    act(() => result.current.reset())
    expect(result.current.isRevealed('serial')).toBe(false)
    expect(result.current.hasHidden).toBe(true)
  })

  it('reports an unknown name as folded rather than throwing', () => {
    const { result } = setup()
    act(() => result.current.revealAll())
    expect(result.current.isRevealed('nope')).toBe(false)
  })
})
