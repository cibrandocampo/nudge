import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import InstallSheet from './InstallSheet'
import s from './InstallCard.module.css'

/**
 * Settings-page card that mirrors the InstallBanner CTA. Permanent surface
 * for users who dismiss-by-ignore the top banner; auto-hides on desktop, in
 * standalone, or after install — same gate as InstallBanner.
 */
export default function InstallCard() {
  const { t } = useTranslation()
  const { canInstall, hasNativePrompt, platform, triggerNativePrompt } = useInstallPrompt()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (!canInstall) return null

  const handleClick = async () => {
    if (hasNativePrompt) {
      try {
        await triggerNativePrompt()
        return
      } catch {
        // Captured event already consumed — fall through to instructions.
      }
    }
    setSheetOpen(true)
  }

  const ctaLabel =
    !hasNativePrompt && platform === 'ios' ? t('pwa.install.ctaIOS') : t('pwa.install.cta')

  return (
    <>
      <div className={s.card} data-testid="install-card">
        <div className={s.header}>
          <img src="/icons/source.svg" alt="" className={s.logo} aria-hidden="true" />
          <p className={s.title}>{t('pwa.install.cardTitle')}</p>
        </div>
        <p className={s.slogan}>{t('pwa.install.cardSlogan')}</p>
        <p className={s.why}>{t('pwa.install.cardWhy')}</p>
        <button
          type="button"
          className={cx(shared.btn, shared.btnPrimary, s.cta)}
          onClick={handleClick}
        >
          {ctaLabel}
        </button>
      </div>
      {sheetOpen && <InstallSheet platform={platform} onClose={() => setSheetOpen(false)} />}
    </>
  )
}
