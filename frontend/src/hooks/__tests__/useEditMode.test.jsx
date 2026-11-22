import { act, renderHook } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useEditMode } from '../useEditMode'

function setup(initialCount = 2) {
  let navigate
  const wrapper = ({ children }) => <MemoryRouter initialEntries={['/inventory/1']}>{children}</MemoryRouter>
  const view = renderHook(
    ({ count }) => {
      navigate = useNavigate()
      return useEditMode({ count })
    },
    { wrapper, initialProps: { count: initialCount } },
  )
  return { ...view, go: (path) => act(() => navigate(path)) }
}

describe('useEditMode', () => {
  it('starts at rest', () => {
    const { result } = setup()
    expect(result.current.editing).toBe(false)
  })

  it('toggles in and out of edit mode', () => {
    const { result } = setup()
    act(() => result.current.toggle())
    expect(result.current.editing).toBe(true)
    act(() => result.current.toggle())
    expect(result.current.editing).toBe(false)
  })

  it('leaves edit mode when the list runs out of rows', () => {
    const { result, rerender } = setup(1)
    act(() => result.current.toggle())
    rerender({ count: 0 })
    expect(result.current.editing).toBe(false)
  })

  it('stays in edit mode while rows remain', () => {
    const { result, rerender } = setup(3)
    act(() => result.current.toggle())
    rerender({ count: 2 })
    expect(result.current.editing).toBe(true)
  })

  it('leaves edit mode when the page changes', () => {
    const { result, go } = setup()
    act(() => result.current.toggle())
    go('/inventory/2')
    expect(result.current.editing).toBe(false)
  })
})
