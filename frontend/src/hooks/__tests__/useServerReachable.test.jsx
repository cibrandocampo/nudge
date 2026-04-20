import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../offline/sync', () => ({ forceSync: vi.fn() }))

import { __resetForTests, setReachable } from '../../offline/reachability'
import { useServerReachable } from '../useServerReachable'

describe('useServerReachable', () => {
  afterEach(() => {
    __resetForTests()
  })

  it('returns the current reachability state', () => {
    const { result } = renderHook(() => useServerReachable())
    expect(result.current).toBe(true)
  })

  it('re-renders when the state flips', () => {
    const { result } = renderHook(() => useServerReachable())

    act(() => {
      setReachable(false)
    })
    expect(result.current).toBe(false)

    act(() => {
      setReachable(true)
    })
    expect(result.current).toBe(true)
  })
})
