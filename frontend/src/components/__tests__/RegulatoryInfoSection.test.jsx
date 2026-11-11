import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../test/mocks/server'
import { mockNetworkError } from '../../test/mocks/handlers'
import { renderWithProviders } from '../../test/helpers'
import RegulatoryInfoSection from '../RegulatoryInfoSection'

const BASE = 'http://localhost/api'
const OFFICIAL = 'FIASP 100 UNIDADES/ML PUMPCART SOLUCION INYECTABLE EN CARTUCHO'
const NOTE = 'Consultar Nota Informativa: https://www.aemps.gob.es/informa/insulinas/ <b>bold</b> for details.'

const summary = (over = {}) => ({
  source: 'aemps',
  code: '728514',
  display_name: 'AEMPS (CIMA)',
  attribution: 'Agencia Española de Medicamentos y Productos Sanitarios (AEMPS) — CIMA',
  language: 'es',
  official_name: OFFICIAL,
  fetch_status: 'ok',
  fetched_at: '2026-11-10T01:00:00Z',
  marketed: true,
  status: 'authorised',
  supply_severity: 'danger',
  affects_driving: true,
  name_offer_pending: false,
  ...over,
})

const activeProblem = (over = {}) => ({
  native_type: '1',
  severity: 'danger',
  note: NOTE,
  started_on: '2025-04-10',
  expected_end_on: '2027-02-28',
  first_seen_at: '2026-11-01T00:00:00Z',
  resolved_at: null,
  active: true,
  ...over,
})

const detail = (over = {}) => ({
  ...summary(),
  agency_url: 'https://cima.aemps.es/cima/publico/detalle.html?nregistro=1161160012',
  presentation_name: `${OFFICIAL}, 5 cartuchos de 1,6 ml`,
  supply_problems: [activeProblem()],
  safety_notices: [],
  ...over,
})

const serveDetail = (body = detail()) =>
  server.use(http.get(`${BASE}/stock/7/regulatory/`, () => HttpResponse.json(body)))

const renderSection = ({ regulatory = summary(), isOwner = true, reachable = true } = {}) =>
  renderWithProviders(
    <RegulatoryInfoSection stock={{ id: 7, name: 'Insulin', regulatory }} isOwner={isOwner} reachable={reachable} />,
  )

describe('RegulatoryInfoSection — fetch states', () => {
  it('a first fetch in flight shows only the indicator', () => {
    renderSection({ regulatory: summary({ fetch_status: 'pending', fetched_at: null, official_name: null }) })
    expect(screen.getByTestId('regulatory-pending')).toHaveTextContent('Consulting AEMPS (CIMA)…')
    expect(screen.queryByTestId('regulatory-chips')).not.toBeInTheDocument()
  })

  it('a refresh in flight keeps the last data under the indicator', async () => {
    serveDetail()
    renderSection({ regulatory: summary({ fetch_status: 'pending' }) })
    expect(screen.getByTestId('regulatory-pending')).toBeInTheDocument()
    expect(screen.getByTestId('regulatory-chips')).toBeInTheDocument()
    expect(await screen.findByTestId('regulatory-active-problem')).toBeInTheDocument()
  })

  it('not found says so and shows no data', () => {
    renderSection({ regulatory: summary({ fetch_status: 'not_found', official_name: null, status: null }) })
    expect(screen.getByTestId('regulatory-not-found')).toHaveTextContent('AEMPS (CIMA) has no medicine')
    expect(screen.queryByTestId('regulatory-chips')).not.toBeInTheDocument()
    expect(screen.queryByTestId('regulatory-source')).not.toBeInTheDocument()
  })

  it('an error without previous data says it could not reach the source', () => {
    renderSection({ regulatory: summary({ fetch_status: 'error', fetched_at: null, official_name: null }) })
    expect(screen.getByTestId('regulatory-error')).toHaveTextContent('Could not reach AEMPS (CIMA). Try again later.')
  })

  it('an error with previous data keeps it and says so', () => {
    serveDetail()
    renderSection({ regulatory: summary({ fetch_status: 'error' }) })
    expect(screen.getByTestId('regulatory-error')).toHaveTextContent('Showing the last data received')
    expect(screen.getByTestId('regulatory-official-name')).toHaveTextContent(OFFICIAL)
  })
})

describe('RegulatoryInfoSection — data', () => {
  it('shows the official name under its label, and the presentation', async () => {
    serveDetail()
    renderSection()
    expect(screen.getByText('Official name:')).toBeInTheDocument()
    expect(screen.getByTestId('regulatory-official-name')).toHaveTextContent(OFFICIAL)
    // Only what the presentation adds: the official name is not printed twice.
    expect(await screen.findByText('5 cartuchos de 1,6 ml')).toBeInTheDocument()
    await screen.findByTestId('leaflet-sections')
  })

  it('shows a presentation name that does not extend the official one in full', async () => {
    serveDetail(detail({ presentation_name: 'OTHER BRAND 100 U/ML, 10 cartuchos' }))
    renderSection()
    expect(await screen.findByText('OTHER BRAND 100 U/ML, 10 cartuchos')).toBeInTheDocument()
  })

  it('shows nothing more when the presentation name is the official one', async () => {
    serveDetail(detail({ presentation_name: OFFICIAL }))
    const { container } = renderSection()
    await screen.findByRole('link', { name: 'View on AEMPS (CIMA)' })
    expect(within(container).getAllByText(OFFICIAL)).toHaveLength(1)
    await screen.findByTestId('leaflet-sections')
  })

  it('shows the presentation in full while the official name is unknown', async () => {
    serveDetail(detail({ presentation_name: `${OFFICIAL}, 5 cartuchos` }))
    renderSection({ regulatory: summary({ fetch_status: 'error', official_name: null }) })
    expect(await screen.findByText(`${OFFICIAL}, 5 cartuchos`)).toBeInTheDocument()
  })

  it.each([
    [null, 'No supply problems', 'ok'],
    ['warning', 'Limited supply', 'warning'],
    ['danger', 'Supply problem', 'danger'],
  ])('supply chip for severity %s', (severity, label, tone) => {
    renderSection({ regulatory: summary({ supply_severity: severity }) })
    const chip = screen.getByTestId('regulatory-supply-chip')
    expect(chip).toHaveTextContent(label)
    expect(chip).toHaveAttribute('data-tone', tone)
  })

  it('marks a medicine that is no longer marketed', () => {
    renderSection({ regulatory: summary({ marketed: false }) })
    expect(screen.getByText('Not marketed')).toBeInTheDocument()
  })

  it('shows no marketing chip when it is unknown', () => {
    renderSection({ regulatory: summary({ marketed: null }) })
    expect(screen.queryByText('Marketed')).not.toBeInTheDocument()
    expect(screen.queryByText('Not marketed')).not.toBeInTheDocument()
  })

  it.each([
    ['authorised', 'Authorised'],
    ['suspended', 'Authorisation suspended'],
    ['revoked', 'Authorisation revoked'],
  ])('authorisation chip for %s', (status, label) => {
    renderSection({ regulatory: summary({ status }) })
    expect(screen.getByTestId('regulatory-status-chip')).toHaveTextContent(label)
  })

  it.each([
    [true, 'May affect driving', 'danger'],
    [false, 'Does not affect driving', 'ok'],
  ])('driving chip when affects_driving is %s', (affects, label, tone) => {
    renderSection({ regulatory: summary({ affects_driving: affects }) })
    const chip = screen.getByRole('button', { name: label })
    expect(chip).toHaveAttribute('data-tone', tone)
  })

  it('with everything in order every chip is green', () => {
    renderSection({ regulatory: summary({ supply_severity: null, affects_driving: false }) })
    const chips = within(screen.getByTestId('regulatory-chips')).getAllByRole('button')
    expect(chips).toHaveLength(4)
    for (const chip of chips) expect(chip).toHaveAttribute('data-tone', 'ok')
  })

  it.each([
    [{ marketed: false }, 'regulatory-marketed-chip', 'warning'],
    [{ status: 'suspended' }, 'regulatory-status-chip', 'danger'],
  ])('a chip out of order takes its tone (%o)', (over, testId, tone) => {
    renderSection({ regulatory: summary(over) })
    expect(screen.getByTestId(testId)).toHaveAttribute('data-tone', tone)
  })

  it('no driving chip when the agency does not say', () => {
    renderSection({ regulatory: summary({ affects_driving: null }) })
    expect(screen.queryByTestId('regulatory-driving-chip')).not.toBeInTheDocument()
  })

  it('the active problem shows its translated type, the rest of the note in its language, and dates', async () => {
    serveDetail()
    renderSection()
    const problem = await screen.findByTestId('regulatory-active-problem')
    expect(problem).toHaveAttribute('data-tone', 'danger')
    expect(within(problem).getByText('See the AEMPS information note')).toBeInTheDocument()
    // The label that only introduced the address goes with it.
    expect(within(problem).queryByText(/Consultar Nota Informativa/)).not.toBeInTheDocument()
    expect(within(problem).getByText('<b>bold</b> for details.')).toHaveAttribute('lang', 'es')
    expect(within(problem).getByText(/^Since /)).toBeInTheDocument()
    expect(within(problem).getByText(/^Expected end: /)).toBeInTheDocument()
  })

  it("opens the note's address from a button, never shows it, and never interprets the markup", async () => {
    serveDetail()
    const { container } = renderSection()
    const problem = await screen.findByTestId('regulatory-active-problem')
    const link = within(problem).getByRole('link', { name: 'Open the notice' })
    expect(link).toHaveAttribute('href', 'https://www.aemps.gob.es/informa/insulinas/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(problem).not.toHaveTextContent('https://')
    expect(container.querySelector('b')).toBeNull()
  })

  it('a note made only of an address leaves just the button', async () => {
    serveDetail(detail({ supply_problems: [activeProblem({ note: 'Consultar Nota Informativa: https://a.es/x/' })] }))
    renderSection()
    const problem = await screen.findByTestId('regulatory-active-problem')
    expect(within(problem).getByRole('link', { name: 'Open the notice' })).toHaveAttribute('href', 'https://a.es/x/')
    expect(problem).not.toHaveTextContent('Consultar')
  })

  it('an unknown supply type falls back to the generic label', async () => {
    serveDetail(detail({ supply_problems: [activeProblem({ native_type: '99' })] }))
    renderSection()
    const problem = await screen.findByTestId('regulatory-active-problem')
    expect(within(problem).getByText('Supply problem')).toBeInTheDocument()
  })

  it('an active problem without note or dates shows just its type', async () => {
    serveDetail(detail({ supply_problems: [activeProblem({ note: '', started_on: null, expected_end_on: null })] }))
    renderSection()
    const problem = await screen.findByTestId('regulatory-active-problem')
    expect(problem).toHaveTextContent('See the AEMPS information note')
    expect(within(problem).queryByText(/^Since/)).not.toBeInTheDocument()
  })

  it('past problems fold and unfold', async () => {
    serveDetail(
      detail({
        supply_problems: [
          activeProblem(),
          activeProblem({ native_type: '4', active: false, resolved_at: '2026-06-01T00:00:00Z' }),
          activeProblem({ native_type: '5', active: false, started_on: null, resolved_at: '2026-01-01T00:00:00Z' }),
        ],
      }),
    )
    const { user } = renderSection()
    const toggle = await screen.findByTestId('regulatory-past-toggle')
    expect(toggle).toHaveTextContent('2 past supply problems')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('regulatory-past-list')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByTestId('regulatory-past-list')
    expect(within(list).getByText('Temporarily out of stock')).toBeInTheDocument()
    expect(within(list).getByText('Other medicines with the same active ingredient exist')).toBeInTheDocument()

    await user.click(toggle)
    expect(screen.queryByTestId('regulatory-past-list')).not.toBeInTheDocument()
  })

  it('safety notices are listed as links in their language', async () => {
    serveDetail(
      detail({
        supply_problems: [],
        safety_notices: [
          {
            reference: 'A',
            native_kind: '1',
            title: 'Vitamina D',
            url: 'https://aemps.gob.es/a',
            published_on: '2026-09-16',
          },
          { reference: 'B', native_kind: '1', title: 'Sin fecha', url: 'https://aemps.gob.es/b', published_on: null },
        ],
      }),
    )
    renderSection({ regulatory: summary({ supply_severity: null }) })
    const notices = await screen.findByTestId('regulatory-notices')
    const [first] = within(notices).getAllByRole('listitem')
    // The title is text in the agency's language; opening it is a button.
    expect(within(first).getByText('Vitamina D')).toHaveAttribute('lang', 'es')
    expect(within(first).getByRole('link', { name: 'Open the notice' })).toHaveAttribute(
      'href',
      'https://aemps.gob.es/a',
    )
    expect(within(notices).getAllByRole('listitem')).toHaveLength(2)
  })

  it('offers no button for a notice whose address is not a web one', async () => {
    serveDetail(
      detail({
        supply_problems: [],
        safety_notices: [
          { reference: 'A', native_kind: '1', title: 'Rara', url: 'javascript:alert(1)', published_on: null },
        ],
      }),
    )
    renderSection({ regulatory: summary({ supply_severity: null }) })
    const notices = await screen.findByTestId('regulatory-notices')
    expect(within(notices).getByText('Rara')).toBeInTheDocument()
    expect(within(notices).queryByRole('link')).not.toBeInTheDocument()
  })

  it('ends with the source, its date and the guidance note, and a button to the agency page', async () => {
    serveDetail()
    renderSection()
    const source = screen.getByTestId('regulatory-source')
    expect(source).toHaveTextContent(
      /^Source: AEMPS \(CIMA\) · updated .+\. For guidance only: if in doubt, ask a health professional\.$/,
    )
    // The agency's full name, which its legal notice asks reusers to cite.
    expect(source).toHaveAttribute('title', summary().attribution)
    const button = await screen.findByRole('link', { name: 'View on AEMPS (CIMA)' })
    expect(button).toHaveAttribute('href', 'https://cima.aemps.es/cima/publico/detalle.html?nregistro=1161160012')
    await screen.findByTestId('leaflet-sections')
  })

  it('offers no agency button until the agency page is known', async () => {
    // No detail yet (the default handler answers 404): there is no page to open.
    renderSection()
    expect(screen.getByTestId('regulatory-source')).toHaveTextContent(/^Source: AEMPS \(CIMA\) · updated /)
    expect(screen.queryByTestId('regulatory-agency-link')).not.toBeInTheDocument()
    await screen.findByTestId('leaflet-sections')
  })

  it('shows the leaflet before the safety notices', async () => {
    serveDetail(
      detail({
        safety_notices: [
          { reference: 'R1', native_kind: '1', title: 'Nota', url: 'https://www.aemps.gob.es/n', published_on: null },
        ],
      }),
    )
    renderSection()
    const notices = await screen.findByTestId('regulatory-notices')
    const leaflet = screen.getByTestId('leaflet')
    expect(leaflet.compareDocumentPosition(notices) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await screen.findByTestId('leaflet-sections')
  })
})

describe('RegulatoryInfoSection — refresh', () => {
  it('is offered to the owner only', () => {
    const { unmount } = renderSection()
    // An icon button: its name is its label.
    expect(screen.getByRole('button', { name: 'Refresh info' })).toBe(screen.getByTestId('regulatory-refresh'))
    unmount()
    renderSection({ isOwner: false })
    expect(screen.queryByTestId('regulatory-refresh')).not.toBeInTheDocument()
  })

  it('is disabled offline, saying why', () => {
    renderSection({ reachable: false })
    expect(screen.getByTestId('regulatory-refresh')).toBeDisabled()
    expect(screen.getByText('Refreshing needs a connection.')).toBeInTheDocument()
  })

  it('posts the refresh and holds the button while it runs', async () => {
    let release
    let posted = false
    server.use(
      http.post(`${BASE}/stock/7/regulatory/refresh/`, async () => {
        posted = true
        await new Promise((resolve) => (release = resolve))
        return HttpResponse.json(
          { id: 7, name: 'Insulin', regulatory: summary({ fetch_status: 'pending' }) },
          { status: 202 },
        )
      }),
    )
    const { user } = renderSection()
    await user.click(screen.getByTestId('regulatory-refresh'))
    await waitFor(() => expect(posted).toBe(true))
    expect(screen.getByTestId('regulatory-refresh')).toBeDisabled()
    release()
    await waitFor(() => expect(screen.getByTestId('regulatory-refresh')).toBeEnabled())
  })

  it('a dropped connection shows the offline hint', async () => {
    server.use(mockNetworkError('post', '/stock/7/regulatory/refresh/'))
    const { user } = renderSection()
    await user.click(screen.getByTestId('regulatory-refresh'))
    expect(await screen.findByText('Refreshing needs a connection.')).toBeInTheDocument()
  })

  it('a refused refresh is reported', async () => {
    server.use(
      http.post(`${BASE}/stock/7/regulatory/refresh/`, () => HttpResponse.json({ detail: 'Nope.' }, { status: 400 })),
    )
    const { user } = renderSection()
    await user.click(screen.getByTestId('regulatory-refresh'))
    expect(await screen.findByText('Nope.')).toBeInTheDocument()
  })
})

describe('RegulatoryInfoSection — leaflet', () => {
  it('offers the leaflet once the agency has answered with data', async () => {
    serveDetail()
    renderSection()
    expect(screen.getByTestId('leaflet-title')).toHaveTextContent('Patient leaflet')
    expect(await screen.findByTestId('leaflet-sections')).toBeInTheDocument()
    await screen.findByTestId('regulatory-active-problem')
  })

  it('does not offer it in any other state', async () => {
    for (const regulatory of [
      summary({ fetch_status: 'pending', fetched_at: null, official_name: null }),
      summary({ fetch_status: 'pending' }),
      summary({ fetch_status: 'not_found', official_name: null, status: null }),
      summary({ fetch_status: 'error' }),
    ]) {
      serveDetail()
      const { unmount } = renderSection({ regulatory })
      expect(screen.queryByTestId('leaflet')).not.toBeInTheDocument()
      // Let the detail request settle before the next render.
      await waitFor(() => expect(screen.getByTestId('regulatory-section')).toBeInTheDocument())
      unmount()
    }
  })
})
