import { useTranslation } from 'react-i18next'
import { diffPayloads } from '../utils/diffPayloads'
import Icon from './Icon'
import ModalFrame from './ModalFrame'
import s from './ConflictModal.module.css'

function formatValue(value) {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(formatValue).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).map(([k, v]) => `${k}: ${formatValue(v)}`)
    return `{ ${entries.join(', ')} }`
  }
  return String(value)
}

/**
 * Opens when the offline queue worker records a 412 on an entry. Renders a
 * per-field diff between the user's local mutation (`mutation.body`) and
 * the server's current version (`mutation.conflictCurrent`). Only fields
 * that actually differ are shown so the user sees exactly what changed.
 *
 * Resolution handlers are passed in by the orchestrator so the modal stays
 * a pure presentational component.
 */
export default function ConflictModal({ mutation, onKeepMine, onUseServer, onClose }) {
  const { t } = useTranslation()

  const local = mutation?.body
  const server = mutation?.conflictCurrent
  const diffs = diffPayloads(local, server)

  return (
    <ModalFrame onClose={onClose} variant="framed" size="md">
      <div data-testid="conflict-modal" className={s.inner}>
        <div className={s.header}>
          <div>
            <h2 id="conflict-title" className={s.title}>
              {t('conflict.title')}
            </h2>
            <p className={s.subtitle}>{t('conflict.subtitle')}</p>
          </div>
          <button type="button" className={s.close} onClick={onClose} aria-label={t('common.close')}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <div className={s.body}>
          {diffs.length === 0 ? (
            <p className={s.empty}>{t('conflict.noDifferences')}</p>
          ) : (
            <dl className={s.diffList}>
              {diffs.map(({ field, localValue, serverValue }) => (
                <div key={field} className={s.diffRow} data-testid={`conflict-diff-field-${field}`}>
                  <dt className={s.diffField}>{t(`field.${field}`, { defaultValue: field })}</dt>
                  <dd className={s.diffCell} data-testid="conflict-yours">
                    <span className={s.diffLabel}>{t('conflict.yourVersion')}</span>
                    <span className={s.diffValue}>{formatValue(localValue)}</span>
                  </dd>
                  <dd className={s.diffCell} data-testid="conflict-server">
                    <span className={s.diffLabel}>{t('conflict.serverVersion')}</span>
                    <span className={s.diffValue}>{formatValue(serverValue)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <div className={s.footer}>
          <button
            type="button"
            className={`${s.btn} ${s.btnSecondary}`}
            onClick={onUseServer}
            data-testid="conflict-action-discard"
          >
            {t('conflict.useServer')}
          </button>
          <button
            type="button"
            className={`${s.btn} ${s.btnPrimary}`}
            onClick={onKeepMine}
            data-testid="conflict-action-overwrite"
          >
            {t('conflict.keepMine')}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}
