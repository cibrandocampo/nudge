import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import OverlayHistory from '../../components/OverlayHistory'
import { useOverlay } from '../useOverlay'

let router

function Overlay({ name, onClose }) {
  useOverlay({ onClose })
  return <div>{name}</div>
}

function Probe() {
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    router = { navigate, location }
  })
  return <p data-testid="path">{location.pathname}</p>
}

// A page with two overlays that can be opened on top of each other.
function Page({ onRender }) {
  const [first, setFirst] = useState(false)
  const [second, setSecond] = useState(false)
  const navigate = useNavigate()
  onRender?.()
  return (
    <>
      <button onClick={() => setFirst(true)}>open first</button>
      <button onClick={() => setSecond(true)}>open second</button>
      <button onClick={() => setFirst(false)}>close first</button>
      <button
        onClick={() => {
          setFirst(false)
          navigate('/next')
        }}
      >
        close and leave
      </button>
      {first && <Overlay name="first overlay" onClose={() => setFirst(false)} />}
      {second && <Overlay name="second overlay" onClose={() => setSecond(false)} />}
    </>
  )
}

function renderPage(props) {
  return render(
    <MemoryRouter initialEntries={['/start', '/page']} initialIndex={1}>
      <OverlayHistory />
      <Probe />
      <Page {...props} />
    </MemoryRouter>,
  )
}

const press = (name) => act(async () => fireEvent.click(screen.getByRole('button', { name })))
const back = () => act(() => router.navigate(-1))
const path = () => screen.getByTestId('path').textContent

describe('useOverlay', () => {
  it('closes only the top overlay on Escape', async () => {
    renderPage()
    await press('open first')
    await press('open second')

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByText('second overlay')).not.toBeInTheDocument()
    expect(screen.getByText('first overlay')).toBeInTheDocument()
  })

  it('closes the overlay on back and stays on the page', async () => {
    renderPage()
    await press('open first')

    back()

    expect(screen.queryByText('first overlay')).not.toBeInTheDocument()
    expect(path()).toBe('/page')
  })

  it('closes nested overlays one back at a time', async () => {
    renderPage()
    await press('open first')
    await press('open second')

    back()
    expect(screen.queryByText('second overlay')).not.toBeInTheDocument()
    expect(screen.getByText('first overlay')).toBeInTheDocument()

    back()
    expect(screen.queryByText('first overlay')).not.toBeInTheDocument()
    expect(path()).toBe('/page')
  })

  it('removes its entry when closed in place, so the next back leaves the page', async () => {
    renderPage()
    await press('open first')
    await press('close first')

    back()

    expect(path()).toBe('/start')
  })

  it('keeps the navigation when closing and leaving in one action', async () => {
    renderPage()
    await press('open first')

    await press('close and leave')

    expect(path()).toBe('/next')
  })

  it('skips the entry of a closed overlay on the way back', async () => {
    renderPage()
    await press('open first')
    await press('close and leave')

    back()

    expect(path()).toBe('/page')
    expect(router.location.state?.overlays).toBeUndefined()
    expect(screen.queryByText('first overlay')).not.toBeInTheDocument()
  })

  it('skips the entry of a closed overlay on the way forward', async () => {
    renderPage()
    await press('open first')
    await press('close and leave')
    back()

    act(() => router.navigate(1))

    expect(path()).toBe('/next')
  })

  it('does not stay on a dead entry at the end of the history', async () => {
    renderPage()
    await press('open first')
    await press('close first')

    act(() => router.navigate(1))

    expect(router.location.state?.overlays).toBeUndefined()
    expect(path()).toBe('/page')
  })

  it('returns to the page underneath when loaded on a leftover entry', async () => {
    render(
      <MemoryRouter initialEntries={['/start', { pathname: '/start', state: { overlays: [9999] } }]} initialIndex={1}>
        <OverlayHistory />
        <Probe />
      </MemoryRouter>,
    )

    expect(router.location.state?.overlays).toBeUndefined()
  })

  it('adds a single entry when its onClose changes on every render', async () => {
    let renders = 0
    renderPage({ onRender: () => (renders += 1) })
    await press('open first')
    await press('open second')
    expect(renders).toBeGreaterThan(1)

    expect(router.location.state.overlays).toHaveLength(2)
  })

  it('adds one entry, not two, under StrictMode', async () => {
    render(
      <MemoryRouter initialEntries={['/start', '/page']} initialIndex={1}>
        <OverlayHistory />
        <Probe />
        <Page />
      </MemoryRouter>,
      { reactStrictMode: true },
    )
    await press('open first')

    expect(router.location.state.overlays).toHaveLength(1)
    back()
    expect(path()).toBe('/page')
    expect(router.location.state?.overlays).toBeUndefined()
  })

  it('keeps a modal opened in the same action that closes a menu', async () => {
    function Swap() {
      const [shown, setShown] = useState('menu')
      return (
        <>
          <button onClick={() => setShown('modal')}>swap</button>
          {shown === 'menu' && <Overlay key="menu" name="menu" onClose={() => setShown(null)} />}
          {shown === 'modal' && <Overlay key="modal" name="modal" onClose={() => setShown(null)} />}
        </>
      )
    }
    window.history.pushState(null, '', '/page')
    render(
      <BrowserRouter>
        <OverlayHistory />
        <Swap />
      </BrowserRouter>,
    )
    await act(async () => {})

    await press('swap')
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    expect(screen.getByText('modal')).toBeInTheDocument()
    expect(window.history.state.usr.overlays).toHaveLength(1)
  })

  it('stays registered once when the route changes under it', async () => {
    render(
      <MemoryRouter initialEntries={['/page']}>
        <Probe />
        <Overlay name="global overlay" onClose={() => {}} />
      </MemoryRouter>,
    )
    await act(async () => {})

    await act(async () => router.navigate('/elsewhere'))

    expect(path()).toBe('/elsewhere')
    expect(router.location.state?.overlays).toBeUndefined()
    expect(screen.getByText('global overlay')).toBeInTheDocument()
  })

  it('leaves no overlay answering Escape after its page unmounts', async () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <MemoryRouter>
        <Overlay name="orphan" onClose={onClose} />
      </MemoryRouter>,
    )
    await act(async () => unmount())

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })
})
