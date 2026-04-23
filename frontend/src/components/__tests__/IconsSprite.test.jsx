import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import IconsSprite from '../IconsSprite'

describe('IconsSprite', () => {
  it('injects the raw SVG sprite hidden at the document root', () => {
    const { container } = render(<IconsSprite />)
    const wrapper = container.firstChild
    expect(wrapper).toBeInTheDocument()
    expect(wrapper).toHaveAttribute('aria-hidden', 'true')
    expect(wrapper.style.display).toBe('none')
    expect(wrapper.innerHTML.length).toBeGreaterThan(0)
  })
})
