import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
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
      <EmptyCard
        title="Empty"
        message="Go add one"
        action={{ label: 'Add stock', to: '/inventory/new' }}
      />,
    )
    const link = screen.getByRole('link', { name: 'Add stock' })
    expect(link).toHaveAttribute('href', '/inventory/new')
  })

  it('omits title and message when not provided', () => {
    const { container } = renderWithRouter(<EmptyCard />)
    expect(container.querySelectorAll('p')).toHaveLength(0)
  })
})
