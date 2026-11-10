import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import LinkifiedText from '../LinkifiedText'

describe('LinkifiedText', () => {
  it('turns each URL into a safe link and keeps the rest as text', () => {
    const { container } = render(
      <LinkifiedText text="See https://a.es/x and http://b.es/y now" className="note" lang="es" />,
    )
    const links = screen.getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://a.es/x', 'http://b.es/y'])
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    const wrapper = container.firstChild
    expect(wrapper).toHaveClass('note')
    expect(wrapper).toHaveAttribute('lang', 'es')
    expect(wrapper).toHaveTextContent('See https://a.es/x and http://b.es/y now')
  })

  it('leaves sentence punctuation out of the link', () => {
    render(<LinkifiedText text="Details: https://a.es/note/." />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://a.es/note/')
    expect(screen.getByText(/Details:/).textContent).toBe('Details: https://a.es/note/.')
  })

  it('a URL at the very start or end needs no surrounding text', () => {
    render(<LinkifiedText text="https://a.es/only" />)
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://a.es/only')
  })

  it('text without URLs is rendered as is', () => {
    render(<LinkifiedText text="Desabastecimiento temporal." />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText('Desabastecimiento temporal.')).toBeInTheDocument()
  })

  it('markup is shown literally, never parsed', () => {
    const { container } = render(<LinkifiedText text={'<img src=x onerror="alert(1)"> <b>hi</b>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.textContent).toBe('<img src=x onerror="alert(1)"> <b>hi</b>')
  })
})
