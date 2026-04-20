import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../Toast'
import { useToast } from '../useToast'

function ToastTrigger({ type = 'info', message = 'hi', duration }) {
  const { showToast } = useToast()
  return (
    <button type="button" onClick={() => showToast({ type, message, duration })}>
      fire
    </button>
  )
}

function Wrapper({ children }) {
  return <ToastProvider>{children}</ToastProvider>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Toast', () => {
  it('throws when useToast is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken() {
      useToast()
      return null
    }
    expect(() => render(<Broken />)).toThrow(/useToast must be used within/)
    spy.mockRestore()
  })

  it('renders a toast after showToast is called', () => {
    render(<ToastTrigger message="hello world" type="success" />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(screen.getByTestId('toast-success')).toBeInTheDocument()
  })

  it('dismisses manually via the close button', () => {
    render(<ToastTrigger message="manual" />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByText('manual')).not.toBeInTheDocument()
  })

  it('auto-dismisses after the configured duration', () => {
    vi.useFakeTimers()
    render(<ToastTrigger message="auto" duration={100} />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    expect(screen.getByText('auto')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(screen.queryByText('auto')).not.toBeInTheDocument()
  })

  it('falls back gracefully when type is unknown', () => {
    render(<ToastTrigger message="weird" type="weird" />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'fire' }))
    // Unknown type still renders the message (Info icon is the default)
    expect(screen.getByText('weird')).toBeInTheDocument()
    expect(screen.getByTestId('toast-weird')).toBeInTheDocument()
  })

  it('stacks multiple toasts simultaneously', () => {
    render(
      <>
        <ToastTrigger message="first" type="info" />
        <ToastTrigger message="second" type="error" />
      </>,
      { wrapper: Wrapper },
    )
    const buttons = screen.getAllByRole('button', { name: 'fire' })
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.getByTestId('toast-info')).toBeInTheDocument()
    expect(screen.getByTestId('toast-error')).toBeInTheDocument()
  })
})
