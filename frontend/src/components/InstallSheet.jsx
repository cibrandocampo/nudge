import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useEscapeKey } from '../hooks/useEscapeKey'
import Icon from './Icon'
import s from './InstallSheet.module.css'

/**
 * Bottom-sheet modal with platform-specific install instructions. Each
 * step renders a numbered marker plus a Lucide icon that mirrors the
 * actual on-screen control the user will tap (share, plus, kebab,
 * download, check). The icon lives outside the i18n string so
 * translators only deal with text.
 *
 * Surfaces a subtitle clarifying this is a Progressive Web App install
 * (lightweight, browser-driven, no app store) — important to set the
 * right expectation since users associate "Install" with the App / Play
 * Store.
 */

const PLATFORM_VARIANTS = {
  ios: {
    titleKey: 'pwa.install.sheetTitleIOS',
    steps: [
      { icon: 'share', labelKey: 'pwa.install.sheetStepIOS1' },
      { icon: 'plus', labelKey: 'pwa.install.sheetStepIOS2' },
      { icon: 'check', labelKey: 'pwa.install.sheetStepIOS3' },
    ],
  },
  'android-chromium': {
    titleKey: 'pwa.install.sheetTitleAndroid',
    steps: [
      { icon: 'more-vertical', labelKey: 'pwa.install.sheetStepAndroid1' },
      { icon: 'download', labelKey: 'pwa.install.sheetStepAndroid2' },
      { icon: 'check', labelKey: 'pwa.install.sheetStepAndroid3' },
    ],
  },
  'firefox-android': {
    titleKey: 'pwa.install.sheetTitleFirefox',
    steps: [
      { icon: 'more-vertical', labelKey: 'pwa.install.sheetStepFirefox1' },
      { icon: 'download', labelKey: 'pwa.install.sheetStepFirefox2' },
      { icon: 'check', labelKey: 'pwa.install.sheetStepFirefox3' },
    ],
  },
  generic: {
    titleKey: 'pwa.install.sheetTitleGeneric',
    steps: [
      { icon: 'more-vertical', labelKey: 'pwa.install.sheetStepGeneric1' },
      { icon: 'download', labelKey: 'pwa.install.sheetStepGeneric2' },
      { icon: 'check', labelKey: 'pwa.install.sheetStepGeneric3' },
    ],
  },
}

export default function InstallSheet({ platform, onClose }) {
  const { t } = useTranslation()
  const titleId = useId()
  useEscapeKey(onClose)

  const stopPropagation = (e) => e.stopPropagation()

  const variant = PLATFORM_VARIANTS[platform] ?? PLATFORM_VARIANTS.generic

  return (
    <div className={s.overlay} onClick={onClose} data-testid="install-sheet-overlay">
      <div
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={stopPropagation}
        data-testid="install-sheet"
      >
        <div className={s.header}>
          <h2 id={titleId} className={s.title}>
            {t(variant.titleKey)}
          </h2>
          <button type="button" className={s.closeBtn} onClick={onClose} aria-label={t('pwa.install.sheetClose')}>
            <Icon name="x" size="sm" />
          </button>
        </div>
        <p className={s.subtitle}>{t('pwa.install.sheetSubtitle')}</p>
        <ol className={s.steps}>
          {variant.steps.map(({ icon, labelKey }, i) => (
            <li key={labelKey} className={s.step}>
              <span className={s.stepNumber} aria-hidden="true">
                {i + 1}
              </span>
              <Icon name={icon} size="sm" className={s.stepIcon} />
              <span className={s.stepLabel}>{t(labelKey)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
