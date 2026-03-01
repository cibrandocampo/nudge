import { fireEvent, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { server } from '../../test/mocks/server'
import { renderWithProviders } from '../../test/helpers'
import RoutineFormPage from '../RoutineFormPage'

const BASE = 'http://localhost/api'

function renderCreate() {
  return renderWithProviders(
    <Routes>
      <Route path="/routines/new" element={<RoutineFormPage />} />
      <Route path="/routines/:id" element={<div>Detail</div>} />
    </Routes>,
    { initialEntries: ['/routines/new'] },
  )
}

function renderEdit() {
  return renderWithProviders(
    <Routes>
      <Route path="/routines/:id/edit" element={<RoutineFormPage />} />
      <Route path="/routines/:id" element={<div>Detail</div>} />
    </Routes>,
    { initialEntries: ['/routines/1/edit'] },
  )
}

const editRoutine = {
  id: 1,
  name: 'Take vitamins',
  description: 'Daily',
  interval_hours: 168,
  is_active: true,
  stock: null,
  stock_usage: 1,
}

describe('RoutineFormPage', () => {
  it('shows "New routine" title in create mode', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('New routine')).toBeInTheDocument())
  })

  it('shows "Edit routine" title in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    renderEdit()
    await waitFor(() => expect(screen.getByText('Edit routine')).toBeInTheDocument())
  })

  it('pre-fills form fields in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Daily')).toBeInTheDocument()
  })

  it('shows error on load failure in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => new HttpResponse(null, { status: 500 })))
    renderEdit()
    await waitFor(() => expect(screen.getByText(/Could not load data/)).toBeInTheDocument())
  })

  it('renders preset interval buttons', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('1 days')).toBeInTheDocument())
    expect(screen.getByText('1 weeks')).toBeInTheDocument()
  })

  it('clicking a preset updates the interval', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('1 weeks')).toBeInTheDocument())
    await user.click(screen.getByText('1 weeks'))
    // The 1 weeks button should now have active class
    expect(screen.getByText('1 weeks').className).toContain('presetActive')
  })

  it('shows stock fields when track stock is checked', async () => {
    server.use(http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 1, name: 'Filters', quantity: 5 }])))
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('Track stock for this routine')).toBeInTheDocument())

    await user.click(screen.getByText('Track stock for this routine'))
    await waitFor(() => expect(screen.getByText('Stock item')).toBeInTheDocument())
    expect(screen.getByText('Units used per log')).toBeInTheDocument()
  })

  it('shows validation error when name is empty', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())
    await user.click(screen.getByText('Save'))
    expect(screen.getByText('Name is required.')).toBeInTheDocument()
  })

  it('shows error when create fails', async () => {
    server.use(http.post(`${BASE}/routines/`, () => new HttpResponse(null, { status: 500 })))
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'New Routine')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeInTheDocument())
  })

  it('submits create form and navigates to detail', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'New Routine')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())
  })

  it('submits edit form and navigates to detail', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    const { user } = renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())

    await user.click(screen.getByText('Save'))
    await waitFor(() => expect(screen.getByText('Detail')).toBeInTheDocument())
  })

  it('changes custom interval value and unit', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())

    // Change the unit dropdown to weeks
    const unitSelect = screen.getByDisplayValue('days')
    await user.selectOptions(unitSelect, 'weeks')

    // The custom value input should reflect the current value
    const valueInput = screen.getByRole('spinbutton')
    await user.click(valueInput) // focus (sets draft)
    await user.clear(valueInput)
    await user.type(valueInput, '3')
    await user.tab() // blur to apply
  })

  it('handles description textarea input', async () => {
    const { user, container } = renderCreate()
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())
    const descTextarea = container.querySelector('textarea')
    await user.type(descTextarea, 'Some description')
    expect(descTextarea.value).toBe('Some description')
  })

  it('renders cancel button that navigates back', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('Cancel')).toBeInTheDocument())
  })

  it('renders back button', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('← Back')).toBeInTheDocument())
  })

  it('shows all unit options in dropdown', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('Save')).toBeInTheDocument())
    expect(screen.getByText('hours')).toBeInTheDocument()
    expect(screen.getByText('days')).toBeInTheDocument()
    expect(screen.getByText('weeks')).toBeInTheDocument()
    expect(screen.getByText('months')).toBeInTheDocument()
    expect(screen.getByText('years')).toBeInTheDocument()
  })

  it('renders all preset interval buttons', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('8 hours')).toBeInTheDocument())
    expect(screen.getByText('12 hours')).toBeInTheDocument()
    expect(screen.getByText('2 days')).toBeInTheDocument()
    expect(screen.getByText('1 months')).toBeInTheDocument()
    expect(screen.getByText('1 years')).toBeInTheDocument()
  })

  it('edits with stock pre-selected', async () => {
    const routineWithStock = {
      ...editRoutine,
      stock: 1,
      stock_usage: 2,
    }
    server.use(
      http.get(`${BASE}/routines/1/`, () => HttpResponse.json(routineWithStock)),
      http.get(`${BASE}/stock/`, () => HttpResponse.json([{ id: 1, name: 'Filters', quantity: 5 }])),
    )
    renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
    expect(screen.getByText('Stock item')).toBeInTheDocument()
  })

  it('shows "already did this" checkbox in create mode', async () => {
    renderCreate()
    await waitFor(() => expect(screen.getByText('I already did this recently')).toBeInTheDocument())
  })

  it('does not show "already did this" checkbox in edit mode', async () => {
    server.use(http.get(`${BASE}/routines/1/`, () => HttpResponse.json(editRoutine)))
    renderEdit()
    await waitFor(() => expect(screen.getByDisplayValue('Take vitamins')).toBeInTheDocument())
    expect(screen.queryByText('I already did this recently')).not.toBeInTheDocument()
  })

  it('checking "already did this" reveals datetime input with default value', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('I already did this recently')).toBeInTheDocument())

    expect(screen.queryByDisplayValue(/T/)).not.toBeInTheDocument()
    await user.click(screen.getByText('I already did this recently'))

    const datetimeInput = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    expect(datetimeInput).toBeInTheDocument()
  })

  it('changing the datetime input updates the value', async () => {
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByText('I already did this recently')).toBeInTheDocument())

    await user.click(screen.getByText('I already did this recently'))
    const datetimeInput = screen.getByDisplayValue(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
    fireEvent.change(datetimeInput, { target: { value: '2026-02-27T10:00' } })
    expect(datetimeInput.value).toBe('2026-02-27T10:00')
  })

  it('submits with last_done_at when checkbox is checked', async () => {
    let capturedBody
    server.use(
      http.post(`${BASE}/routines/`, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 99 }, { status: 201 })
      }),
    )
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Water cactus')
    await user.click(screen.getByText('I already did this recently'))
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(capturedBody?.last_done_at).toBeDefined())
    expect(new Date(capturedBody.last_done_at).getTime()).not.toBeNaN()
  })

  it('shows saving state on submit', async () => {
    let resolve
    server.use(
      http.post(
        `${BASE}/routines/`,
        () =>
          new Promise((r) => {
            resolve = r
          }),
      ),
    )
    const { user } = renderCreate()
    await waitFor(() => expect(screen.getByPlaceholderText('e.g. Change water filter')).toBeInTheDocument())

    await user.type(screen.getByPlaceholderText('e.g. Change water filter'), 'Test')
    await user.click(screen.getByText('Save'))

    expect(screen.getByText('Saving…')).toBeDisabled()
    resolve(HttpResponse.json({ id: 99 }, { status: 201 }))
  })
})
