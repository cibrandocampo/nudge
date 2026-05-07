import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import OfflineLockedPlaceholder from '../OfflineLockedPlaceholder'

function renderAt(path = '/history') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<OfflineLockedPlaceholder />} />
        <Route path="/" element={<div>Dashboard stub</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('OfflineLockedPlaceholder', () => {
  it('renders the wifi-off icon, title, body, and back-home CTA from i18n', () => {
    renderAt()
    const wrapper = screen.getByTestId('offline-locked-placeholder')
    expect(wrapper).toBeInTheDocument()
    // Title is rendered as a heading so screen readers can land on it.
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back home/i })).toBeInTheDocument()
  })

  it('navigates back to / when the CTA is clicked', async () => {
    const user = userEvent.setup()
    renderAt('/settings')
    await user.click(screen.getByRole('button', { name: /back home/i }))
    // The dashboard stub takes over → confirms useNavigate('/') fired.
    expect(screen.getByText('Dashboard stub')).toBeInTheDocument()
  })
})
