import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import cx from '../utils/cx'
import { regulatoryLabels } from '../utils/stockAlerts'
import Icon from './Icon'
import s from './RegulatoryAlerts.module.css'

/**
 * What the agency warns about, right under the product's header (T206): the
 * medicine section is folded by default, and folding must never hide a supply
 * problem, a suspension or a safety notice. Each line opens that section.
 *
 * Props:
 *   stock  — the stock, with its `regulatory` summary
 *   onOpen — unfolds the medicine section and moves the focus there
 */
export default function RegulatoryAlerts({ stock, onOpen }) {
  const { t } = useTranslation()
  // Only reads what the medicine section below fetches: it stays mounted while
  // folded, and a second fetcher would double its refetch after a refresh.
  const { data: detail } = useQuery({ queryKey: ['stock', Number(stock.id), 'regulatory'], enabled: false })
  const notices = detail?.safety_notices?.length ?? 0
  const alerts = regulatoryLabels(stock).map((label) => ({ id: label.key, text: t(label.key), tone: label.tone }))
  if (notices > 0) {
    alerts.push({ id: 'notices', text: t('regulatory.safetyNoticesCount', { count: notices }), tone: 'warning' })
  }
  if (alerts.length === 0) return null

  return (
    <ul className={s.list} data-testid="regulatory-alerts">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <button
            type="button"
            className={cx(s.alert, alert.tone === 'danger' ? s.danger : s.warning)}
            onClick={onOpen}
            data-testid="regulatory-alert"
            data-tone={alert.tone}
          >
            <Icon name="alert-triangle" size="sm" />
            <span className={s.text}>{alert.text}</span>
            <Icon name="chevron-down" size="sm" />
          </button>
        </li>
      ))}
    </ul>
  )
}
