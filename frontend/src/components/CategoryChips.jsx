import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import Icon from './Icon'
import s from './CategoryChips.module.css'

/**
 * The categories of a product: any number of them, one toggle each. A chosen
 * chip is filled and carries a check, so the state never depends on colour.
 *
 * Props:
 *   groups   — the user's categories, in their order
 *   value    — ids of the chosen ones
 *   onChange — called with the new list of ids
 */
export default function CategoryChips({ groups, value, onChange }) {
  const { t } = useTranslation()

  if (groups.length === 0) {
    return (
      <p className={s.empty}>
        {t('stockForm.groupsEmpty')}{' '}
        <Link to="/inventory/groups" className={s.manage}>
          {t('inventory.manageGroups')}
        </Link>
      </p>
    )
  }

  const toggle = (id) => onChange(value.includes(id) ? value.filter((other) => other !== id) : [...value, id])

  return (
    <div className={s.chips} role="group" aria-label={t('stockForm.groupLabel')} data-testid="category-chips">
      {groups.map((group) => {
        const chosen = value.includes(group.id)
        return (
          <button
            key={group.id}
            type="button"
            className={cx(s.chip, chosen && s.chosen)}
            aria-pressed={chosen}
            onClick={() => toggle(group.id)}
          >
            {chosen && <Icon name="check" size="sm" />}
            <span>{group.name}</span>
          </button>
        )
      })}
    </div>
  )
}
