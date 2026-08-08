import { useTranslation } from 'react-i18next'
import { avatarInitial, displayLabel } from '../utils/displayName'
import forms from '../styles/forms.module.css'
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
    <div className={forms.formChipsRow}>
      {contacts.map((c) => {
        const label = displayLabel(c)
        return (
          <span key={c.id} className={forms.formChip}>
            <span className={forms.formChipAvatar} aria-hidden="true">
              {avatarInitial(c)}
            </span>
            <span>{label}</span>
            {onRemove && (
              <button
                type="button"
                className={forms.formChipRemove}
                onClick={() => onRemove(c.id)}
                aria-label={t('stockForm.removeShare', { name: label })}
              >
                <Icon name="x" size="sm" />
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}
