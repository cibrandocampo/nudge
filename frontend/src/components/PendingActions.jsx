import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstallAction } from '../hooks/useInstallAction'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import { pendingActions } from '../hooks/usePendingActions'
import buttons from '../styles/buttons.module.css'
import cx from '../utils/cx'
import Icon from './Icon'
import InstallSheet from './InstallSheet'
import s from './PendingActions.module.css'

/**
 * First thing in Settings while the device is not ready for reminders: each
 * action with what is at risk without it. The notice shown everywhere else
 * leads here. It disappears once there is nothing left to do.
 *
 * Props:
 *   pushStatus   — Settings' `usePushStatus()`, so the panel and the section
 *                  below it always agree
 *   onEnablePush — asks for permission and subscribes
 *   pushLoading  — that is in progress
 *   disabled     — offline: enabling needs the server
 */
export default function PendingActions({ pushStatus, onEnablePush, pushLoading = false, disabled = false }) {
  const { t } = useTranslation()
  const titleId = useId()
  const installPrompt = useInstallPrompt()
  const { platform } = installPrompt
  const { install, push, pushState, count } = pendingActions(installPrompt, pushStatus)
  const { install: runInstall, sheetOpen, closeSheet } = useInstallAction()

  const pushNote = {
    'needs-https': t('pending.push.needsHttps'),
    'needs-install': t('pending.push.needsInstall'),
    blocked: t('pending.push.blocked'),
  }[pushState]

  return (
    <>
      {count > 0 && (
        <section id="pending" className={s.panel} aria-labelledby={titleId} data-testid="pending-actions">
          <div className={s.header}>
            <Icon name="alert-triangle" className={s.icon} />
            <div>
              <h2 id={titleId} className={s.title}>
                {t('pending.title')}
              </h2>
              <p className={s.intro}>{t('pending.intro')}</p>
            </div>
          </div>
          <ul className={s.list}>
            {install && (
              <li className={s.row} data-testid="pending-install">
                <Icon name="download" className={s.icon} />
                <div className={s.text}>
                  <p className={s.rowTitle}>{t('pending.install.title')}</p>
                  <p className={s.risk}>{t(platform === 'ios' ? 'pending.install.riskIos' : 'pending.install.risk')}</p>
                </div>
                <button type="button" className={s.cta} onClick={runInstall}>
                  {t('pending.install.cta')}
                </button>
              </li>
            )}
            {push && (
              <li className={s.row} data-testid="pending-push">
                <Icon name="bell" className={s.icon} />
                <div className={s.text}>
                  <p className={s.rowTitle}>{t('pending.push.title')}</p>
                  <p className={s.risk}>{t('pending.push.risk')}</p>
                  {pushNote && <p className={s.note}>{pushNote}</p>}
                </div>
                {pushState === 'ready' && (
                  <button
                    type="button"
                    className={cx(s.cta, (pushLoading || disabled) && buttons.disabled)}
                    onClick={onEnablePush}
                    disabled={pushLoading || disabled}
                    title={disabled ? t('offline.requiresConnection') : undefined}
                  >
                    {pushLoading ? '…' : t('pending.push.cta')}
                  </button>
                )}
              </li>
            )}
          </ul>
        </section>
      )}
      {sheetOpen && <InstallSheet platform={platform} onClose={closeSheet} />}
    </>
  )
}
