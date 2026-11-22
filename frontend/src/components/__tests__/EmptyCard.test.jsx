import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import EmptyCard from '../EmptyCard'

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('EmptyCard', () => {
  it('renders title + message without an action link', () => {
    renderWithRouter(<EmptyCard title="All done" message="Nothing more to do" />)
    expect(screen.getByText('All done')).toBeInTheDocument()
    expect(screen.getByText('Nothing more to do')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders the action link when provided', () => {
    renderWithRouter(
      <EmptyCard title="Empty" message="Go add one" action={{ label: 'Add stock', to: '/inventory/new' }} />,
    )
    const link = screen.getByRole('link', { name: 'Add stock' })
    expect(link).toHaveAttribute('href', '/inventory/new')
  })

  it('a page action is a primary button by default', () => {
    const onClick = vi.fn()
    renderWithRouter(<EmptyCard action={{ label: 'Do it', onClick }} />)
    const button = screen.getByRole('button', { name: 'Do it' })
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.className).toMatch(/primary/)
  })

  it('can be a secondary button', () => {
    renderWithRouter(<EmptyCard action={{ label: 'Clear', onClick: vi.fn(), secondary: true }} />)
    expect(screen.getByRole('button', { name: 'Clear' }).className).toMatch(/secondary/)
  })

  it('an unavailable action stays focusable and still explains itself on click', () => {
    const onClick = vi.fn()
    renderWithRouter(<EmptyCard action={{ label: 'Add', onClick, unavailable: true }} />)
    const button = screen.getByRole('button', { name: 'Add' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('omits title and message when not provided', () => {
    const { container } = renderWithRouter(<EmptyCard />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})
