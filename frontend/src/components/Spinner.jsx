import layout from '../styles/layout.module.css'
/**
 * Inline page-level spinner. Used inside <QueryHandler> and as a direct
 * child of pages that don't yet wrap their query state in <QueryHandler>.
 * The data-testid is preserved so existing E2E selectors keep working.
 */
export default function Spinner() {
  return <div className={layout.spinner} data-testid="spinner" />
}
