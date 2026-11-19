import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FormField from '../FormField'

describe('FormField', () => {
  it('renders label and children when label is provided', () => {
    render(
      <FormField label="Name">
        <input data-testid="input" />
      </FormField>,
    )
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByTestId('input')).toBeInTheDocument()
  })

  it('renders children without a label when label is absent', () => {
    const { container } = render(
      <FormField>
        <input data-testid="input" />
      </FormField>,
    )
    expect(screen.getByTestId('input')).toBeInTheDocument()
    expect(container.querySelector('label')).toBeNull()
  })

  it('renders the hint suffix next to the label when both are present', () => {
    render(
      <FormField label="Email" hint="optional">
        <input />
      </FormField>,
    )
    expect(screen.getByText('Email')).toBeInTheDocument()
    expect(screen.getByText(/optional/)).toBeInTheDocument()
  })

  it('renders the error message below the input when error is provided', () => {
    render(
      <FormField label="Name" error="Required field">
        <input />
      </FormField>,
    )
    expect(screen.getByText('Required field')).toBeInTheDocument()
  })
})

describe('FormField — the label names its control', () => {
  it('points the label at a native child', () => {
    render(
      <FormField label="Description">
        <textarea />
      </FormField>,
    )
    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA')
  })

  it('keeps an id the child already has', () => {
    render(
      <FormField label="Category">
        <select id="own-id">
          <option>One</option>
        </select>
      </FormField>,
    )
    expect(screen.getByLabelText('Category')).toHaveAttribute('id', 'own-id')
  })

  it('marks a required native child with aria-required, not with the hidden asterisk', () => {
    render(
      <FormField label="Name" required>
        <input />
      </FormField>,
    )
    expect(screen.getByLabelText(/Name/)).toHaveAttribute('aria-required', 'true')
  })

  it('names a wrapped control through controlId', () => {
    render(
      <FormField label="Expiry date" controlId="expiry">
        <div>
          <input id="expiry" type="date" />
        </div>
      </FormField>,
    )
    expect(screen.getByLabelText('Expiry date')).toHaveAttribute('type', 'date')
  })

  it('leaves a complex child alone', () => {
    render(
      <FormField label="Interval">
        <div data-testid="picker">
          <button type="button">−</button>
          <button type="button">+</button>
        </div>
      </FormField>,
    )
    expect(screen.getByTestId('picker')).not.toHaveAttribute('id')
    expect(screen.getByText('Interval').closest('label')).not.toHaveAttribute('for')
  })
})
