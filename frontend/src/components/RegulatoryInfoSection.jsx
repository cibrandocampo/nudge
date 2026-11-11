import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineError } from '../api/errors'
import { useRefreshRegulatory } from '../hooks/mutations/useRefreshRegulatory'
import { useRegulatoryDetail } from '../hooks/useRegulatoryDetail'
import cx from '../utils/cx'
import { errorToastMessage } from '../utils/errors'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import IconChip from './IconChip'
import LeafletAccordion from './LeafletAccordion'
import { splitNoteLinks } from '../utils/noteLinks'
import { useToast } from './useToast'
import buttons from '../styles/buttons.module.css'
import layout from '../styles/layout.module.css'
import s from './RegulatoryInfoSection.module.css'

// Severity → chip tone. The agency's own problem codes never reach this file:
// `severity` is the normalised value the backend derives from them.
const TONE = { warning: s.toneWarning, danger: s.toneDanger }

// Agency URLs are followed only when they are web addresses.
const WEB_URL = /^https?:\/\//i

/**
 * What the presentation adds to the medicine name — usually the pack size.
 *
 * Agencies name a presentation as the medicine name plus the pack
 * ("FIASP …, 5 cartuchos de 1,6 ml"); printing both repeats a long upper-case
 * line. When the presentation does not start with the medicine name it is shown
 * whole.
 */
function packDescription(officialName, presentationName) {
  if (!presentationName) return null
  if (!officialName || !presentationName.startsWith(officialName)) return presentationName
  return presentationName.slice(officialName.length).replace(/^[\s,]+/, '') || null
}

/**
 * "Medicine information": what the regulatory agency says about the stock's
 * medicine, on the product page.
 *
 * Built only from model fields — the summary on the stock and the detail
 * endpoint — never from an agency's payload, so it stays agency-neutral: the
 * source's name, language and citation come with the data. Agency text (a
 * supply note, a notice title) is shown verbatim and tagged with its language.
 *
 * States of the fetch: `pending` (in flight: a first fetch has nothing to
 * show yet, a refresh keeps the last data under an indicator), `not_found`
 * (the agency has no such code), `error` (the last good data stays, if any).
 */
export default function RegulatoryInfoSection({ stock, isOwner, reachable }) {
  const { t, i18n } = useTranslation()
  const { showToast } = useToast()
  const summary = stock.regulatory
  const { data: detail } = useRegulatoryDetail(stock.id, summary)
  const refresh = useRefreshRegulatory()
  const [pastOpen, setPastOpen] = useState(false)
  const [offlineHint, setOfflineHint] = useState(false)

  const source = summary.display_name
  const status = summary.fetch_status
  const hasData = Boolean(summary.fetched_at) && status !== 'not_found'
  const problems = detail?.supply_problems ?? []
  const active = problems.find((problem) => problem.active)
  const past = problems.filter((problem) => !problem.active)
  const activeNote = splitNoteLinks(active?.note ?? '')
  const notices = detail?.safety_notices ?? []
  const pack = packDescription(summary.official_name, detail?.presentation_name)

  const supplyLabel = (nativeType) => {
    const key = `regulatory.supply.${summary.source}.${nativeType}`
    return i18n.exists(key) ? t(key) : t('regulatory.supply.unknown')
  }

  const onRefresh = async () => {
    setOfflineHint(false)
    try {
      await refresh.mutateAsync({ stockId: stock.id })
    } catch (err) {
      // Not queueable: a connection lost between render and click rejects.
      if (err instanceof OfflineError) setOfflineHint(true)
      else showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  return (
    <section className={s.section} data-testid="regulatory-section">
      <p className={layout.sectionTitle}>{t('regulatory.title')}</p>
      <div className={s.card}>
        {hasData && (
          <div className={s.identity}>
            {/* The agency's name is long and upper case: labelled and kept
                lighter than the product's own name in the card above, which is
                the one the user recognises. */}
            <p className={s.officialLine}>
              <span className={s.officialNameLabel}>{t('regulatory.officialName')}</span>{' '}
              <span className={s.officialName} data-testid="regulatory-official-name">
                {summary.official_name}
              </span>
            </p>
            {pack && <span className={s.presentation}>{pack}</span>}
          </div>
        )}

        {status === 'pending' && (
          <p className={s.state} data-testid="regulatory-pending">
            <Icon name="clock" size="sm" />
            {t('regulatory.pending', { source })}
          </p>
        )}
        {status === 'not_found' && (
          <p className={s.state} data-testid="regulatory-not-found">
            {t('regulatory.notFound', { source })}
          </p>
        )}
        {status === 'error' && (
          <p className={cx(s.state, s.stateError)} data-testid="regulatory-error">
            <Icon name="alert-triangle" size="sm" />
            {t(hasData ? 'regulatory.errorStale' : 'regulatory.error', { source })}
          </p>
        )}

        {hasData && (
          <>
            <div className={s.chips} data-testid="regulatory-chips">
              {/* Icons that unfold their text (tap, hover, focus); the tone
                  says good or bad at a glance. */}
              <IconChip
                icon="truck"
                label={
                  summary.supply_severity
                    ? t(`regulatory.supplyChip.${summary.supply_severity}`)
                    : t('regulatory.supply.none')
                }
                className={TONE[summary.supply_severity] ?? s.toneOk}
                data-testid="regulatory-supply-chip"
                data-tone={summary.supply_severity ?? 'ok'}
              />
              {summary.marketed !== null && (
                <IconChip
                  icon="shopping-cart"
                  label={t(summary.marketed ? 'regulatory.marketed.yes' : 'regulatory.marketed.no')}
                  className={summary.marketed ? s.toneOk : s.toneWarning}
                  data-testid="regulatory-marketed-chip"
                  data-tone={summary.marketed ? 'ok' : 'warning'}
                />
              )}
              {summary.status && (
                <IconChip
                  icon={summary.status === 'authorised' ? 'badge-check' : 'badge'}
                  label={t(`regulatory.status.${summary.status}`)}
                  className={summary.status === 'authorised' ? s.toneOk : s.toneDanger}
                  data-testid="regulatory-status-chip"
                  data-tone={summary.status === 'authorised' ? 'ok' : 'danger'}
                />
              )}
              {/* Nothing when the agency does not say. */}
              {summary.affects_driving !== null && summary.affects_driving !== undefined && (
                <IconChip
                  icon="car"
                  label={t(summary.affects_driving ? 'regulatory.driving.yes' : 'regulatory.driving.no')}
                  className={summary.affects_driving ? s.toneDanger : s.toneOk}
                  data-testid="regulatory-driving-chip"
                  data-tone={summary.affects_driving ? 'danger' : 'ok'}
                />
              )}
            </div>

            {active && (
              <div
                className={cx(s.problem, TONE[active.severity])}
                data-testid="regulatory-active-problem"
                data-tone={active.severity}
              >
                <span className={s.problemTitle}>{supplyLabel(active.native_type)}</span>
                {activeNote.text && (
                  <span className={s.note} lang={summary.language}>
                    {activeNote.text}
                  </span>
                )}
                <span className={s.dates}>
                  {active.started_on && t('regulatory.since', { date: formatShortDate(active.started_on) })}
                  {active.expected_end_on && (
                    <span>{t('regulatory.expectedEnd', { date: formatShortDate(active.expected_end_on) })}</span>
                  )}
                </span>
                {/* The note's addresses as buttons, the same as a safety
                    notice's: the raw URL is never shown. */}
                {activeNote.urls.map((url) => (
                  <a
                    key={url}
                    className={cx(buttons.btn, buttons.btnSecondary, s.actionBtn, s.problemOpen)}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="regulatory-problem-link"
                  >
                    <Icon name="external-link" size="sm" />
                    {t('regulatory.openNotice')}
                  </a>
                ))}
              </div>
            )}

            {past.length > 0 && (
              <div className={s.block}>
                <button
                  type="button"
                  className={s.disclosure}
                  aria-expanded={pastOpen}
                  onClick={() => setPastOpen((open) => !open)}
                  data-testid="regulatory-past-toggle"
                >
                  {t('regulatory.pastProblems', { count: past.length })}
                  <Icon name={pastOpen ? 'chevron-up' : 'chevron-down'} size="sm" />
                </button>
                {pastOpen && (
                  <ul className={s.list} data-testid="regulatory-past-list">
                    {past.map((problem) => (
                      <li key={`${problem.native_type}-${problem.first_seen_at}`} className={s.pastItem}>
                        <span>{supplyLabel(problem.native_type)}</span>
                        <span className={s.dates}>
                          {formatShortDate(problem.started_on ?? problem.first_seen_at)} –{' '}
                          {formatShortDate(problem.resolved_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* The leaflet before the notices: it is what most visits are for. */}
            {status === 'ok' && <LeafletAccordion stockId={stock.id} summary={summary} />}

            {notices.length > 0 && (
              <div className={s.block}>
                <span className={s.blockTitle}>{t('regulatory.safetyNotices')}</span>
                <ul className={s.list} data-testid="regulatory-notices">
                  {notices.map((notice) => (
                    <li key={notice.reference} className={s.notice}>
                      <span className={s.noticeText}>
                        <span lang={summary.language}>{notice.title}</span>
                        {notice.published_on && <span className={s.dates}>{formatShortDate(notice.published_on)}</span>}
                      </span>
                      {/* A button, not an inline link. The URL is the agency's:
                          only a web address is followed. */}
                      {WEB_URL.test(notice.url) && (
                        <a
                          className={cx(buttons.btnIcon, buttons.btnIconOutline, s.noticeOpen)}
                          href={notice.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t('regulatory.openNotice')}
                          title={t('regulatory.openNotice')}
                        >
                          <Icon name="external-link" size="sm" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {(hasData || isOwner) && (
          <div className={s.footer}>
            {/* Source, date and guidance in one quiet line: citing the origin and
              the date of the data is what the AEMPS legal notice asks for
              reuse; the agency's full name is the line's title. */}
            {hasData && (
              <p className={s.sourceNote} title={summary.attribution} data-testid="regulatory-source">
                {t('regulatory.sourceLabel', { source })} ·{' '}
                {t('regulatory.sourceUpdated', { date: formatShortDate(summary.fetched_at) })}.{' '}
                {t('regulatory.guidance')}
              </p>
            )}
            <div className={s.footerActions}>
              {detail?.agency_url && (
                <a
                  className={cx(buttons.btn, buttons.btnSecondary, s.actionBtn)}
                  href={detail.agency_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="regulatory-agency-link"
                >
                  <Icon name="external-link" size="sm" />
                  {t('regulatory.viewOnSource', { source })}
                </a>
              )}
              {isOwner && (
                <button
                  type="button"
                  className={cx(buttons.btnIcon, buttons.btnIconOutline)}
                  onClick={onRefresh}
                  disabled={!reachable || refresh.isPending}
                  aria-label={t('regulatory.refresh')}
                  title={t('regulatory.refresh')}
                  data-testid="regulatory-refresh"
                >
                  <Icon name="refresh-cw" size="sm" />
                </button>
              )}
            </div>
          </div>
        )}
        {isOwner && (!reachable || offlineHint) && <p className={s.hint}>{t('regulatory.refreshOffline')}</p>}
      </div>
    </section>
  )
}
