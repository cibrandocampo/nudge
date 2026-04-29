import { useTranslation } from 'react-i18next'
import { avatarInitial, displayLabel } from '../utils/displayName'
import shared from '../styles/shared.module.css'
import Icon from './Icon'

/**
 * Renders chips (avatar initial + display label) for a list of contacts.
 * If `onRemove` is provided, each chip exposes an X button that calls
 * `onRemove(id)` — used by ShareWithSection (editable). Otherwise the
 * chips are read-only — used by StockDetailPage and RoutineDetailPage
 * to visualize the share state.
 *
 * Reuses the shared chip styles (`shared.formChipsRow / formChip /
 * formChipAvatar / formChipRemove`) already used by ShareWithSection.
 */
export default function SharedWithChips({ contacts = [], onRemove }) {
  const { t } = useTranslation()
  if (!contacts || contacts.length === 0) return null
  return (
    <div className={shared.formChipsRow}>
      {contacts.map((c) => (
        <span key={c.id} className={shared.formChip}>
          <span className={shared.formChipAvatar} aria-hidden="true">
            {avatarInitial(c)}
          </span>
          <span>{onRemove ? displayLabel(c) : c.username}</span>
          {onRemove && (
            <button
              type="button"
              className={shared.formChipRemove}
              onClick={() => onRemove(c.id)}
              aria-label={t('stockForm.removeShare', { name: c.username })}
            >
              <Icon name="x" size="sm" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
