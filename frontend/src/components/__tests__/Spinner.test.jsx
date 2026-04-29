import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Spinner from '../Spinner'

describe('Spinner', () => {
  it('renders an element with the spinner testid', () => {
    const { getByTestId } = render(<Spinner />)
    expect(getByTestId('spinner')).toBeInTheDocument()
  })
})
