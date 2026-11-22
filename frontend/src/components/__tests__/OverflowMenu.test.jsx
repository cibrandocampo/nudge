import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import OverflowMenu from '../OverflowMenu'

function Where() {
  const { pathname } = useLocation()
  return <p data-testid="where">{pathname}</p>
}

function setup({ items } = {}) {
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const onOffline = vi.fn()
  const list = items ?? [
    { key: 'history', label: 'View history', icon: 'history', to: '/history' },
    { key: 'edit', label: 'Rename', onSelect: onEdit },
    { key: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: onDelete },
  ]
  const view = renderWithProviders(
    <>
      <OverflowMenu items={list} />
      <button type="button">After</button>
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </>,
    { initialEntries: ['/product'] },
  )
  const trigger = screen.getByRole('button', { name: 'More actions' })
  return { ...view, trigger, onEdit, onDelete, onOffline }
}

const items = () => screen.getAllByRole('menuitem')

describe('OverflowMenu', () => {
  it('is a menu button: closed, it says it opens a menu and controls nothing yet', () => {
    const { trigger } = setup()
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('aria-controls')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('a click opens the menu on its first item and links the trigger to it', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'More actions' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', menu.id)
    expect(items().map((i) => i.textContent)).toEqual(['View history', 'Rename', 'Delete'])
    expect(items()[0]).toHaveFocus()
  })

  it('a second click on the trigger closes it', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.click(trigger)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([['{ArrowDown}'], ['{Enter}'], [' ']])('%s on the trigger opens it on the first item', async (key) => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard(key)
    expect(items()[0]).toHaveFocus()
  })

  it('any other key on the trigger leaves it closed', async () => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard('a{ArrowLeft}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('↑ on the trigger opens it on the last item', async () => {
    const { user, trigger } = setup()
    trigger.focus()
    await user.keyboard('{ArrowUp}')
    expect(items()[2]).toHaveFocus()
  })

  it('↓ and ↑ move through the items and wrap at both ends', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{ArrowDown}')
    expect(items()[1]).toHaveFocus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(items()[0]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(items()[2]).toHaveFocus()
  })

  it('Home and End jump to the first and last item', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{End}')
    expect(items()[2]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(items()[0]).toHaveFocus()
  })

  it('Esc closes it and gives the focus back to the trigger', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('Tab closes it and the focus moves on to the next control', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('choosing an action runs it, closes the menu and returns the focus to the trigger', async () => {
    const { user, trigger, onEdit } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('Enter on a focused item chooses it', async () => {
    const { user, trigger, onDelete } = setup()
    await user.click(trigger)
    await user.keyboard('{End}{Enter}')
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('a link item navigates and the route change closes the menu', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'View history' })).toHaveAttribute('href', '/history')
    await user.click(screen.getByRole('menuitem', { name: 'View history' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/history')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Space on a focused link item follows it, as on a button', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.keyboard(' ')
    expect(screen.getByTestId('where')).toHaveTextContent('/history')
  })

  it('a disabled item stays focusable, says so, and runs its refusal instead of the action', async () => {
    const onSelect = vi.fn()
    const onDisabledSelect = vi.fn()
    const { user, trigger } = setup({
      items: [{ key: 'delete', label: 'Delete', disabled: true, onSelect, onDisabledSelect }],
    })
    await user.click(trigger)
    const item = screen.getByRole('menuitem', { name: 'Delete' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
    expect(item).toHaveFocus()
    await user.click(item)
    expect(onDisabledSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('a disabled link item does not navigate', async () => {
    const onDisabledSelect = vi.fn()
    const { user, trigger } = setup({
      items: [{ key: 'h', label: 'View history', to: '/history', disabled: true, onDisabledSelect }],
    })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'View history' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/product')
    expect(onDisabledSelect).toHaveBeenCalledTimes(1)
  })

  it('a pointer outside the menu closes it, without moving the focus back', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'After' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('a pointer inside the menu does not close it', async () => {
    const { user, trigger } = setup()
    await user.click(trigger)
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('menu') })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})
