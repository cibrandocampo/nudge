import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { OfflineError } from '../api/errors'
import { useRefreshRegulatory } from '../hooks/mutations/useRefreshRegulatory'
import { useRegulatoryDetail } from '../hooks/useRegulatoryDetail'
import cx from '../utils/cx'
import { errorToastMessage } from '../utils/errors'
import { formatShortDate } from '../utils/time'
import Icon from './Icon'
import LeafletAccordion from './LeafletAccordion'
import LinkifiedText from './LinkifiedText'
import { useToast } from './useToast'
import buttons from '../styles/buttons.module.css'
import layout from '../styles/layout.module.css'
import s from './RegulatoryInfoSection.module.css'

// Severity → chip tone. The agency's own problem codes never reach this file:
// `severity` is the normalised value the backend derives from them.
const TONE = { warning: s.toneWarning, danger: s.toneDanger }

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
            <span className={s.officialName} data-testid="regulatory-official-name">
              {summary.official_name}
            </span>
            {pack && <span className={s.presentation}>{pack}</span>}
            <span className={s.sourceLine}>
              {t('regulatory.sourceLine', { source, date: formatShortDate(summary.fetched_at) })}
            </span>
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
              <span
                className={cx(s.chip, TONE[summary.supply_severity] ?? s.toneOk)}
                data-testid="regulatory-supply-chip"
                data-tone={summary.supply_severity ?? 'ok'}
              >
                {summary.supply_severity
                  ? t(`regulatory.supplyChip.${summary.supply_severity}`)
                  : t('regulatory.supply.none')}
              </span>
              {summary.marketed !== null && (
                <span className={cx(s.chip, summary.marketed ? s.toneNeutral : s.toneWarning)}>
                  {t(summary.marketed ? 'regulatory.marketed.yes' : 'regulatory.marketed.no')}
                </span>
              )}
              {summary.status && (
                <span
                  className={cx(s.chip, summary.status === 'authorised' ? s.toneNeutral : s.toneDanger)}
                  data-testid="regulatory-status-chip"
                >
                  {t(`regulatory.status.${summary.status}`)}
                </span>
              )}
            </div>

            {active && (
              <div
                className={cx(s.problem, TONE[active.severity])}
                data-testid="regulatory-active-problem"
                data-tone={active.severity}
              >
                <span className={s.problemTitle}>{supplyLabel(active.native_type)}</span>
                {active.note && <LinkifiedText text={active.note} className={s.note} lang={summary.language} />}
                <span className={s.dates}>
                  {active.started_on && t('regulatory.since', { date: formatShortDate(active.started_on) })}
                  {active.expected_end_on && (
                    <span>{t('regulatory.expectedEnd', { date: formatShortDate(active.expected_end_on) })}</span>
                  )}
                </span>
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

            {notices.length > 0 && (
              <div className={s.block}>
                <span className={s.blockTitle}>{t('regulatory.safetyNotices')}</span>
                <ul className={s.list} data-testid="regulatory-notices">
                  {notices.map((notice) => (
                    <li key={notice.reference} className={s.notice}>
                      <a href={notice.url} target="_blank" rel="noopener noreferrer" lang={summary.language}>
                        {notice.title}
                      </a>
                      {notice.published_on && <span className={s.dates}>{formatShortDate(notice.published_on)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {status === 'ok' && <LeafletAccordion stockId={stock.id} summary={summary} />}
          </>
        )}

        <div className={s.footer}>
          {detail?.agency_url && (
            <a className={s.sourceLink} href={detail.agency_url} target="_blank" rel="noopener noreferrer">
              {t('regulatory.viewOnSource', { source })}
            </a>
          )}
          {isOwner && (
            <button
              type="button"
              className={cx(buttons.btn, buttons.btnSecondary, s.refresh)}
              onClick={onRefresh}
              disabled={!reachable || refresh.isPending}
              data-testid="regulatory-refresh"
            >
              {t('regulatory.refresh')}
            </button>
          )}
        </div>
        {isOwner && (!reachable || offlineHint) && <p className={s.hint}>{t('regulatory.refreshOffline')}</p>}

        {hasData && <p className={s.disclaimer}>{t('regulatory.disclaimer', { attribution: summary.attribution })}</p>}
      </div>
    </section>
  )
}
