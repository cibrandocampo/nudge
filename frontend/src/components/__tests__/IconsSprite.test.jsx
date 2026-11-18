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

describe('icon sprite symbols', () => {
  it('has the QR code icon used by the automatic lot entry', () => {
    const { container } = render(<IconsSprite />)
    const symbol = container.querySelector('symbol#i-qr-code')
    expect(symbol).not.toBeNull()
    expect(symbol.getAttribute('viewBox')).toBe('0 0 24 24')
  })
})
