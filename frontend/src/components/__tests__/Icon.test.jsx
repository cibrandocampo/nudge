import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Icon from '../Icon'

function getSvg(container) {
  return container.querySelector('svg')
}

function getUseHref(container) {
  return container.querySelector('use').getAttribute('href')
}

describe('Icon', () => {
  it('renders an <svg> with <use> referencing the sprite', () => {
    const { container } = render(<Icon name="check" />)
    expect(getSvg(container)).toBeInTheDocument()
    expect(getUseHref(container)).toBe('#i-check')
  })

  it('applies the default icon size class', () => {
    const { container } = render(<Icon name="check" />)
    expect(getSvg(container).getAttribute('class')).toContain('icon')
  })

  it('applies the small size class', () => {
    const { container } = render(<Icon name="x" size="sm" />)
    expect(getSvg(container).getAttribute('class')).toContain('icon-sm')
  })

  it('applies the large size class', () => {
    const { container } = render(<Icon name="user" size="lg" />)
    expect(getSvg(container).getAttribute('class')).toContain('icon-lg')
  })

  it('falls back to no size modifier for an unknown size', () => {
    const { container } = render(<Icon name="user" size="xxl" />)
    const cls = getSvg(container).getAttribute('class')
    expect(cls).toContain('icon')
    expect(cls).not.toContain('icon-sm')
    expect(cls).not.toContain('icon-lg')
  })

  it('merges an external className', () => {
    const { container } = render(<Icon name="plus" className="extra" />)
    expect(getSvg(container).getAttribute('class')).toContain('extra')
  })

  it('marks the svg as decorative with aria-hidden', () => {
    const { container } = render(<Icon name="plus" />)
    expect(getSvg(container).getAttribute('aria-hidden')).toBe('true')
  })
})
