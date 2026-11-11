import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import LeafletAccordion from '../LeafletAccordion'

const BASE = 'http://localhost/api'
const SOURCE_URL = 'https://cima.aemps.es/cima/dochtml/p/1161160012/P_1161160012.html'
const PDF_URL = 'https://cima.aemps.es/cima/pdfs/p/1161160012/P_1161160012.pdf'

const summary = (over = {}) => ({
  display_name: 'AEMPS (CIMA)',
  fetched_at: '2026-11-10T01:00:00Z',
  ...over,
})

const leaflet = (over = {}) => ({
  sections: [
    { key: '0', title: 'Introducción', html: '<p>Lea todo el prospecto.</p>' },
    { key: '1', title: 'Qué es Fiasp', html: '<p>Fiasp es una insulina.</p><table><tr><td>1</td></tr></table>' },
  ],
  source_url: SOURCE_URL,
  pdf_url: PDF_URL,
  fetched_at: '2026-11-10T01:00:00Z',
  language: 'es',
  ...over,
})

// Serves `answers` in turn (the last one repeats) and counts the requests.
function serveLeaflet(...answers) {
  const calls = { count: 0 }
  server.use(
    http.get(`${BASE}/stock/7/leaflet/`, () => {
      const answer = answers[Math.min(calls.count, answers.length - 1)]
      calls.count += 1
      return answer()
    }),
  )
  return calls
}

const ok =
  (body = leaflet()) =>
  () =>
    HttpResponse.json(body)
const pending = () => HttpResponse.json({ code: 'leaflet_pending' }, { status: 404 })
const broken = () => new HttpResponse('upstream exploded', { status: 500 })

const renderAccordion = (props = {}) =>
  renderWithProviders(<LeafletAccordion stockId={7} summary={summary()} {...props} />)

const sectionToggle = (name) => screen.getByRole('button', { name })

beforeEach(() => {
  // jsdom implements no scrolling.
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  delete Element.prototype.scrollIntoView
})

describe('LeafletAccordion — loading', () => {
  it('shows its title and loads the sections with a single request', async () => {
    const calls = serveLeaflet(ok())
    renderAccordion()
    expect(screen.getByTestId('leaflet-title')).toHaveTextContent('Patient leaflet')
    expect(await screen.findByTestId('leaflet-sections')).toBeInTheDocument()
    expect(calls.count).toBe(1)
  })

  it('shows a loading line until the leaflet arrives', async () => {
    let release
    const held = new Promise((resolve) => {
      release = resolve
    })
    serveLeaflet(async () => {
      await held
      return HttpResponse.json(leaflet())
    })
    renderAccordion()
    expect(screen.getByTestId('leaflet-loading')).toHaveTextContent('Loading the leaflet…')
    release()
    await screen.findByTestId('leaflet-sections')
    expect(screen.queryByTestId('leaflet-loading')).not.toBeInTheDocument()
  })
})

describe('LeafletAccordion — states', () => {
  it('a leaflet not downloaded yet is pending, not an error, and can be asked again', async () => {
    const calls = serveLeaflet(pending, ok())
    const { user } = renderAccordion()
    expect(await screen.findByTestId('leaflet-pending')).toHaveTextContent('The leaflet is not available yet.')
    expect(screen.queryByTestId('leaflet-error')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('leaflet-retry'))
    expect(await screen.findByTestId('leaflet-sections')).toBeInTheDocument()
    expect(calls.count).toBe(2)
  })

  it('a failure says so and retries on demand', async () => {
    const calls = serveLeaflet(broken, ok())
    const { user } = renderAccordion()
    const error = await screen.findByTestId('leaflet-error')
    expect(error).toHaveTextContent('Could not load the leaflet.')

    await user.click(within(error).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('leaflet-sections')).toBeInTheDocument()
    expect(calls.count).toBe(2)
  })

  it('another 404 is an error, not pending', async () => {
    serveLeaflet(() => HttpResponse.json({ code: 'no_national_code' }, { status: 404 }))
    renderAccordion()
    expect(await screen.findByTestId('leaflet-error')).toBeInTheDocument()
  })

  it('without sections only the link to the source is offered', async () => {
    serveLeaflet(ok(leaflet({ sections: [] })))
    renderAccordion()
    expect(await screen.findByTestId('leaflet-source-link')).toBeInTheDocument()
    expect(screen.queryByTestId('leaflet-sections')).not.toBeInTheDocument()
  })

  it('without a source page there is no link', async () => {
    serveLeaflet(ok(leaflet({ sections: [], source_url: '' })))
    renderAccordion()
    await screen.findByTestId('leaflet')
    await waitFor(() => expect(screen.queryByTestId('leaflet-loading')).not.toBeInTheDocument())
    expect(screen.queryByTestId('leaflet-source-link')).not.toBeInTheDocument()
  })

  it('with sections the source link is left to the card: no second agency button', async () => {
    serveLeaflet(ok())
    renderAccordion()
    await screen.findByTestId('leaflet-sections')
    expect(screen.queryByTestId('leaflet-source-link')).not.toBeInTheDocument()
  })

  it('the PDF to download sits beside the title', async () => {
    serveLeaflet(ok())
    renderAccordion()
    const download = await screen.findByRole('link', { name: 'Download the leaflet (PDF)' })
    expect(download).toHaveAttribute('href', PDF_URL)
    expect(download).toHaveAttribute('target', '_blank')
    expect(download).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('no PDF, no download button', async () => {
    serveLeaflet(ok(leaflet({ pdf_url: '' })))
    renderAccordion()
    await screen.findByTestId('leaflet-sections')
    expect(screen.queryByTestId('leaflet-download')).not.toBeInTheDocument()
  })
})

describe('LeafletAccordion — sections', () => {
  it('opening a section shows its HTML in the leaflet language', async () => {
    serveLeaflet(ok())
    const { user } = renderAccordion()
    await user.click(await screen.findByRole('button', { name: 'Introducción' }))
    const html = screen.getByTestId('leaflet-section-html')
    expect(html).toHaveAttribute('lang', 'es')
    expect(html.innerHTML).toBe('<p>Lea todo el prospecto.</p>')
  })

  it('opening another section closes the first', async () => {
    serveLeaflet(ok())
    const { user } = renderAccordion()
    await user.click(await screen.findByRole('button', { name: 'Introducción' }))
    await user.click(sectionToggle('Qué es Fiasp'))
    const panels = screen.getAllByTestId('leaflet-section-html')
    expect(panels).toHaveLength(1)
    expect(panels[0]).toHaveTextContent('Fiasp es una insulina.')
    expect(sectionToggle('Introducción')).toHaveAttribute('aria-expanded', 'false')
  })

  it('clicking an open section closes it', async () => {
    serveLeaflet(ok())
    const { user } = renderAccordion()
    await user.click(await screen.findByRole('button', { name: 'Introducción' }))
    await user.click(sectionToggle('Introducción'))
    expect(screen.queryByTestId('leaflet-section-html')).not.toBeInTheDocument()
  })

  it('aria-expanded and aria-controls point at the open panel', async () => {
    serveLeaflet(ok())
    const { user } = renderAccordion()
    const toggle = await screen.findByRole('button', { name: 'Qué es Fiasp' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle.getAttribute('aria-controls')).toBe(screen.getByTestId('leaflet-section-html').id)
  })

  it('the opened section is brought into view and focused', async () => {
    serveLeaflet(ok())
    const { user } = renderAccordion()
    await user.click(await screen.findByRole('button', { name: 'Introducción' }))
    const toggle = sectionToggle('Qué es Fiasp')
    toggle.scrollIntoView.mockClear()
    await user.click(toggle)
    expect(toggle.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(toggle).toHaveFocus()
  })

  it('the source link opens a new tab without opener', async () => {
    serveLeaflet(ok(leaflet({ sections: [] })))
    renderAccordion()
    const link = await screen.findByTestId('leaflet-source-link')
    expect(link).toHaveTextContent('View the leaflet on AEMPS (CIMA)')
    expect(link).toHaveAttribute('href', SOURCE_URL)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('LeafletAccordion — freshness', () => {
  it('a new fetched_at in the summary asks for the leaflet again', async () => {
    const calls = serveLeaflet(ok(), ok(leaflet({ sections: [{ key: '0', title: 'Nueva', html: '<p>x</p>' }] })))
    const { rerender } = renderAccordion()
    await screen.findByRole('button', { name: 'Introducción' })

    rerender(<LeafletAccordion stockId={7} summary={summary({ fetched_at: '2026-11-11T01:00:00Z' })} />)
    expect(await screen.findByRole('button', { name: 'Nueva' })).toBeInTheDocument()
    expect(calls.count).toBe(2)
  })

  it('the same fetched_at does not', async () => {
    const calls = serveLeaflet(ok())
    const { rerender } = renderAccordion()
    await screen.findByTestId('leaflet-sections')
    rerender(<LeafletAccordion stockId={7} summary={summary()} />)
    await waitFor(() => expect(screen.getByTestId('leaflet-sections')).toBeInTheDocument())
    expect(calls.count).toBe(1)
  })
})
