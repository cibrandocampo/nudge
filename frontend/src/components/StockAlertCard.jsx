import Icon from './Icon'
import cx from '../utils/cx'
import cards from '../styles/cards.module.css'
/**
 * The two severities the inventory alerts speak, and every class each one
 * picks. `shared.module.css` already names them `danger` and `warning`; this
 * map is the single place that turns either word into classes, so a block
 * cannot end up with a red border and an orange dot.
 *
 * `tail` belongs here because a badge's trailing note always carries its
 * card's severity — an expired lot's date is red inside a red card, a
 * depletion estimate orange inside an orange one.
 */
const VARIANTS = {
  danger: { border: cards.cardBorderDanger, dot: cards.dotDanger, tail: cards.stockDepletionDanger },
  warning: { border: cards.cardBorderWarning, dot: cards.dotWarning, tail: cards.stockDepletionWarn },
}

/**
 * The card skeleton behind every inventory alert block: a severity-bordered
 * card, a coloured dot beside the title, and a list of badges.
 *
 * Whether a block appears at all stays with the page — that is a question
 * about data (`criticalStockItems.length > 0`), not about drawing a card.
 *
 * Props:
 *   variant  — 'danger' | 'warning'
 *   title    — already-translated heading
 *   testId   — the block's `data-testid`, one per call site
 *   children — the badges, normally `StockAlertBadge`
 */
export default function StockAlertCard({ variant, title, testId, children }) {
  return (
    <div className={cx(cards.card, VARIANTS[variant].border)} data-testid={testId}>
      <div className={cards.cardHeader}>
        <div className={cards.cardMeta}>
          <div className={cx(cards.cardTitle, cards.cardTitleFlex)}>
            <span className={cx(cards.dot, VARIANTS[variant].dot)} />
            {title}
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * One line inside an alert card: a package icon, what is wrong, and an
 * optional trailing note in the card's severity colour.
 *
 * Props:
 *   variant  — 'danger' | 'warning', colours `tail`
 *   tail     — trailing note, e.g. "(expired 3 Mar)". Omit for no note.
 *   children — the main text
 */
export function StockAlertBadge({ variant, tail, children }) {
  return (
    <span className={cards.cardStockBadge}>
      <Icon name="package" size="sm" />
      <span>{children}</span>
      {tail && <span className={VARIANTS[variant].tail}> {tail}</span>}
    </span>
  )
}
