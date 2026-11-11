import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLeaflet } from '../hooks/useLeaflet'
import cx from '../utils/cx'
import Icon from './Icon'
import buttons from '../styles/buttons.module.css'
import s from './LeafletAccordion.module.css'

/**
 * The patient leaflet, read inside the app: one button per section, one
 * section open at a time.
 *
 * The section titles are on screen from the start — the leaflet is a main
 * feature, not a fold to discover — so the whole leaflet comes in one request
 * as the page opens and stays in the persisted cache, readable offline
 * afterwards. The PDF to download sits beside the title. With no sections
 * (the agency publishes none) the link to the agency's own page is offered
 * instead: with sections it would only repeat the card's own agency link.
 */
export default function LeafletAccordion({ stockId, summary }) {
  const { t } = useTranslation()
  const idPrefix = useId()
  const [openKey, setOpenKey] = useState(null)
  const headers = useRef({})
  const { data, isError, refetch, isFetching } = useLeaflet(stockId, summary.fetched_at)

  // Opening a section closes the previous one, which may sit above it: bring
  // the new header back under the user's eye and give it the focus.
  useEffect(() => {
    if (openKey === null) return
    const header = headers.current[openKey]
    header.scrollIntoView({ block: 'start' })
    header.focus({ preventScroll: true })
  }, [openKey])

  const sections = data?.sections ?? []
  const retryButton = (
    <button
      type="button"
      className={cx(buttons.btn, buttons.btnSecondary, s.retry)}
      onClick={() => refetch()}
      disabled={isFetching}
      data-testid="leaflet-retry"
    >
      {t('regulatory.leaflet.retry')}
    </button>
  )

  let body
  if (data?.pending) {
    body = (
      <div className={s.state} data-testid="leaflet-pending">
        <span>{t('regulatory.leaflet.pending')}</span>
        {retryButton}
      </div>
    )
  } else if (data) {
    body = (
      <>
        {sections.length > 0 && (
          <ul className={s.sections} data-testid="leaflet-sections">
            {sections.map((section) => {
              const expanded = openKey === section.key
              const panelId = `${idPrefix}-leaflet-${section.key}`
              return (
                <li key={section.key} className={s.sectionItem}>
                  <button
                    type="button"
                    ref={(node) => {
                      headers.current[section.key] = node
                    }}
                    className={s.sectionHeader}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => setOpenKey(expanded ? null : section.key)}
                    lang={data.language}
                    data-testid="leaflet-section-toggle"
                  >
                    <span className={s.sectionTitle}>{section.title}</span>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size="sm" />
                  </button>
                  {expanded && (
                    // Agency HTML, rendered as markup. Safe ONLY because the
                    // backend reduces it to a strict allowlist before storing
                    // it (`backend/apps/regulatory/sanitize.py`: no scripts,
                    // styles, event handlers or remote images). Never pass
                    // HTML from any other origin through here.
                    <div
                      id={panelId}
                      className={s.leafletHtml}
                      lang={data.language}
                      dangerouslySetInnerHTML={{ __html: section.html }}
                      data-testid="leaflet-section-html"
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {sections.length === 0 && data.source_url && (
          <a
            className={cx(buttons.btn, buttons.btnSecondary, s.sourceLink)}
            href={data.source_url}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="leaflet-source-link"
          >
            <Icon name="external-link" size="sm" />
            {t('regulatory.leaflet.viewSource', { source: summary.display_name })}
          </a>
        )}
      </>
    )
  } else if (isError) {
    body = (
      <div className={cx(s.state, s.stateError)} data-testid="leaflet-error">
        <span>{t('regulatory.leaflet.error')}</span>
        {retryButton}
      </div>
    )
  } else {
    body = (
      <p className={s.state} data-testid="leaflet-loading">
        {t('regulatory.leaflet.loading')}
      </p>
    )
  }

  return (
    <div className={s.leaflet} data-testid="leaflet">
      <div className={s.titleRow}>
        <span className={s.title} data-testid="leaflet-title">
          {t('regulatory.leaflet.title')}
        </span>
        {data?.pdf_url && (
          <a
            className={cx(buttons.btnIcon, buttons.btnIconOutline)}
            href={data.pdf_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('regulatory.leaflet.download')}
            title={t('regulatory.leaflet.download')}
            data-testid="leaflet-download"
          >
            <Icon name="download" size="sm" />
          </a>
        )}
      </div>
      {body}
    </div>
  )
}
