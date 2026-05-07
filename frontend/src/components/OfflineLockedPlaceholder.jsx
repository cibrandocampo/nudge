import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import shared from '../styles/shared.module.css'
import s from './OfflineLockedPlaceholder.module.css'

/**
 * Full-page placeholder rendered by `OfflineRouteGuard` when the user
 * navigates to a route that is locked offline (`/history`, `/settings`).
 * Shows a clear icon + message + a "back home" CTA so the user always
 * has an obvious way out — staying on the locked URL itself works too;
 * the guard swaps back to the real page once reachability returns.
 */
export default function OfflineLockedPlaceholder() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  return (
    <div className={s.wrapper} data-testid="offline-locked-placeholder">
      <Icon name="wifi-off" size="lg" />
      <h2 className={s.title}>{t('offline.pageLockedTitle')}</h2>
      <p className={s.body}>{t('offline.pageLockedBody')}</p>
      <button type="button" className={shared.btn} onClick={() => navigate('/')}>
        {t('offline.backHome')}
      </button>
    </div>
  )
}
