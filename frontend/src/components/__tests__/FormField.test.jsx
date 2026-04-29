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
