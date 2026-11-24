import { render, screen } from '@testing-library/react'
import FormActions from '../FormActions'

describe('FormActions', () => {
  it('keeps its children in the order written, so Tab follows the screen', () => {
    render(
      <FormActions>
        <button>Cancel</button>
        <button>Save</button>
      </FormActions>,
    )

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Save'])
  })

  it('applies the fill and inset layouts on request', () => {
    const { container } = render(<FormActions fill inset />)

    expect(container.firstChild.className).toMatch(/fill/)
    expect(container.firstChild.className).toMatch(/inset/)
  })

  it('has neither layout by default, and keeps a caller class', () => {
    const { container } = render(<FormActions className="caller" />)

    expect(container.firstChild.className).not.toMatch(/fill|inset/)
    expect(container.firstChild).toHaveClass('caller')
  })
})
