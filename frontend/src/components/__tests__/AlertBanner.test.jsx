import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AlertBanner from '../AlertBanner'

describe('AlertBanner', () => {
  it('renders children inside a status role', () => {
    render(<AlertBanner variant="warning">Hello there</AlertBanner>)
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('Hello there')
  })

  it('applies the warning variant class by default', () => {
    render(<AlertBanner>Warning message</AlertBanner>)
    const banner = screen.getByRole('status')
    expect(banner.className).toMatch(/warning/)
    expect(banner.className).not.toMatch(/danger/)
  })

  it('applies the danger variant class when requested', () => {
    render(<AlertBanner variant="danger">Something broke</AlertBanner>)
    const banner = screen.getByRole('status')
    expect(banner.className).toMatch(/danger/)
    expect(banner.className).not.toMatch(/\bwarning\b/)
  })

  it('mounts an Icon when the icon prop is provided', () => {
    const { container } = render(
      <AlertBanner variant="warning" icon="alert-triangle">
        With icon
      </AlertBanner>,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg.querySelector('use').getAttribute('href')).toBe('/icons.svg#i-alert-triangle')
  })

  it('omits the Icon when the icon prop is not provided', () => {
    const { container } = render(<AlertBanner>No icon</AlertBanner>)
    expect(container.querySelector('svg')).toBeNull()
  })
})
