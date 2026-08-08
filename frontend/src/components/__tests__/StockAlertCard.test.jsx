import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/helpers'
import StockAlertCard, { StockAlertBadge } from '../StockAlertCard'
import cards from '../../styles/cards.module.css'
describe('StockAlertCard', () => {
  it('renders the title and the given testId', () => {
    renderWithProviders(
      <StockAlertCard variant="danger" title="Expiry reached" testId="expiry-reached-alert">
        <span>badge</span>
      </StockAlertCard>,
    )
    const card = screen.getByTestId('expiry-reached-alert')
    expect(card).toHaveTextContent('Expiry reached')
  })

  it('renders its children inside the card', () => {
    renderWithProviders(
      <StockAlertCard variant="warning" title="Low stock" testId="low-stock-alert">
        <span data-testid="child">4 × Aspirin</span>
      </StockAlertCard>,
    )
    expect(screen.getByTestId('low-stock-alert')).toContainElement(screen.getByTestId('child'))
  })

  // The border and the dot must move together: a red card with an orange dot
  // is exactly the drift that having one variant map prevents.
  it('applies the danger border and dot for variant="danger"', () => {
    renderWithProviders(
      <StockAlertCard variant="danger" title="Critical stock" testId="critical-stock-alert">
        <span>badge</span>
      </StockAlertCard>,
    )
    const card = screen.getByTestId('critical-stock-alert')
    expect(card).toHaveClass(cards.card, cards.cardBorderDanger)
    expect(card.querySelector(`.${cards.dot}`)).toHaveClass(cards.dotDanger)
  })

  it('applies the warning border and dot for variant="warning"', () => {
    renderWithProviders(
      <StockAlertCard variant="warning" title="Expiring soon" testId="expiring-soon-alert">
        <span>badge</span>
      </StockAlertCard>,
    )
    const card = screen.getByTestId('expiring-soon-alert')
    expect(card).toHaveClass(cards.card, cards.cardBorderWarning)
    expect(card.querySelector(`.${cards.dot}`)).toHaveClass(cards.dotWarning)
  })
})

describe('StockAlertBadge', () => {
  it('renders the main text with a package icon', () => {
    const { container } = renderWithProviders(<StockAlertBadge variant="danger">0 × Vitamin D</StockAlertBadge>)
    const badge = container.querySelector(`.${cards.cardStockBadge}`)
    expect(badge).toHaveTextContent('0 × Vitamin D')
    expect(badge.querySelector('svg')).toBeInTheDocument()
  })

  it('omits the trailing note when no tail is given', () => {
    const { container } = renderWithProviders(<StockAlertBadge variant="danger">0 × Vitamin D</StockAlertBadge>)
    expect(container.querySelector(`.${cards.stockDepletionDanger}`)).toBeNull()
    expect(container.querySelector(`.${cards.stockDepletionWarn}`)).toBeNull()
  })

  it('colours the tail with the danger severity', () => {
    const { container } = renderWithProviders(
      <StockAlertBadge variant="danger" tail="(expired 3 Mar)">
        4 × Aspirin
      </StockAlertBadge>,
    )
    expect(container.querySelector(`.${cards.stockDepletionDanger}`)).toHaveTextContent('(expired 3 Mar)')
  })

  it('colours the tail with the warning severity', () => {
    const { container } = renderWithProviders(
      <StockAlertBadge variant="warning" tail="(until 15 May)">
        10 × Insulin
      </StockAlertBadge>,
    )
    expect(container.querySelector(`.${cards.stockDepletionWarn}`)).toHaveTextContent('(until 15 May)')
  })

  // The space belongs inside the tail span, as it did when this markup lived
  // in the page: without it the badge reads "10 × Insulin(until 15 May)".
  it('separates the tail from the main text', () => {
    const { container } = renderWithProviders(
      <StockAlertBadge variant="warning" tail="(until 15 May)">
        10 × Insulin
      </StockAlertBadge>,
    )
    expect(container.querySelector(`.${cards.cardStockBadge}`).textContent).toBe('10 × Insulin (until 15 May)')
  })
})
