import i18n from 'i18next'
import { STORAGE_KEY } from '../../appearance'
import { AuthContext } from '../../contexts/AuthContext'
import { act, render, renderWithProviders, screen, waitFor } from '../../test/helpers'
import AppearanceProvider from '../AppearanceProvider'

const html = document.documentElement

const profile = (overrides) => ({
  id: 1,
  email: 'testuser@example.com',
  language: 'en',
  theme: 'system',
  text_size: 'normal',
  ...overrides,
})

afterEach(async () => {
  delete html.dataset.theme
  html.style.fontSize = ''
  localStorage.clear()
  await act(() => i18n.changeLanguage('en'))
})

describe('AppearanceProvider', () => {
  it('applies the profile theme, text size and language, and remembers the appearance', async () => {
    renderWithProviders(
      <AppearanceProvider>
        <p>content</p>
      </AppearanceProvider>,
      { auth: { user: profile({ theme: 'dark', text_size: 'large', language: 'es' }) } },
    )

    expect(screen.getByText('content')).toBeInTheDocument()
    await waitFor(() => expect(i18n.language).toBe('es'))
    expect(html.dataset.theme).toBe('dark')
    expect(html.style.fontSize).toBe('112.5%')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ theme: 'dark', textSize: 'large' })
  })

  it('the profile wins over the copy this device stored', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'dark', textSize: 'xlarge' }))
    html.dataset.theme = 'dark'

    renderWithProviders(<AppearanceProvider />, { auth: { user: profile({ theme: 'system' }) } })

    expect(html.hasAttribute('data-theme')).toBe(false)
    expect(html.style.fontSize).toBe('100%')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ theme: 'system', textSize: 'normal' })
  })

  it('signed out, keeps what the device last applied', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: 'dark', textSize: 'xlarge' }))
    html.dataset.theme = 'dark'
    html.style.fontSize = '125%'

    renderWithProviders(<AppearanceProvider />, { auth: { user: null } })

    expect(html.dataset.theme).toBe('dark')
    expect(html.style.fontSize).toBe('125%')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ theme: 'dark', textSize: 'xlarge' })
    expect(i18n.language).toBe('en')
  })

  it('follows the profile when the user signs in and when it changes', () => {
    const tree = (user) => (
      <AuthContext.Provider value={{ user }}>
        <AppearanceProvider />
      </AuthContext.Provider>
    )
    const { rerender } = render(tree(null))
    expect(html.hasAttribute('data-theme')).toBe(false)

    rerender(tree(profile({ theme: 'light' })))
    expect(html.dataset.theme).toBe('light')

    rerender(tree(profile({ theme: 'dark', text_size: 'xlarge' })))
    expect(html.dataset.theme).toBe('dark')
    expect(html.style.fontSize).toBe('125%')
  })
})
