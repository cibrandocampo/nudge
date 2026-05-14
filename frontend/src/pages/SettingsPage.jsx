import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import { api } from '../api/client'
import { OfflineError } from '../api/errors'
import { useAuth } from '../contexts/AuthContext'
import { useContacts } from '../hooks/useContacts'
import { useCreateContact } from '../hooks/mutations/useCreateContact'
import { useDeleteContact } from '../hooks/mutations/useDeleteContact'
import { useUpdateMe } from '../hooks/mutations/useUpdateMe'
import { usePushStatus } from '../hooks/usePushStatus'
import { useServerReachable } from '../hooks/useServerReachable'
import AlertBanner from '../components/AlertBanner'
import ChangePasswordModal from '../components/ChangePasswordModal'
import Combobox from '../components/Combobox'
import ConfirmModal from '../components/ConfirmModal'
import Icon from '../components/Icon'
import InstallCard from '../components/InstallCard'
import { useToast } from '../components/useToast'
import { subscribeToPush, unsubscribeFromPush } from '../utils/push'
import cx from '../utils/cx'
import { avatarInitial, fullName } from '../utils/displayName'
import { errorToastMessage } from '../utils/errors'
import shared from '../styles/shared.module.css'
import s from './SettingsPage.module.css'

const TIMEZONES = Intl.supportedValuesOf('timeZone')

const LANGUAGES = [
  { code: 'en', labelKey: 'settings.languageEn' },
  { code: 'es', labelKey: 'settings.languageEs' },
  { code: 'gl', labelKey: 'settings.languageGl' },
]

// True when `time` (HH:MM) falls inside the [start, end) range. Returns false
// when any input is empty or when the range collapses to zero (start === end).
// Supports midnight-crossing ranges (e.g. 22:00 → 07:00).
function isInQuietHours(time, start, end) {
  if (!time || !start || !end || start === end) return false
  if (start < end) return time >= start && time < end
  return time >= start || time < end
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { showToast } = useToast()
  const { hash } = useLocation()
  const [flashId, setFlashId] = useState(null)

  // Scroll to a specific section when the URL has a hash (e.g. #push from
  // the global notifications-off banner) and trigger a one-shot flash so
  // the user sees where attention should land.
  useEffect(() => {
    if (!hash) return
    const id = hash.slice(1)
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFlashId(id)
    const timer = setTimeout(() => setFlashId(null), 1200)
    return () => clearTimeout(timer)
  }, [hash])

  const [form, setForm] = useState(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    daily_notification_time: '08:00',
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
  }))

  const {
    permission: pushPermission,
    subscribed: pushSubscribed,
    setPermission: setPushPermission,
    setSubscribed: setPushSubscribed,
  } = usePushStatus()
  const [pushLoading, setPushLoading] = useState(false)

  const [contactEmail, setContactEmail] = useState('')
  // True once an add-contact attempt has failed for the current value;
  // cleared the moment the user edits the field. Drives the red
  // border / text on the input so the offending email is visually
  // marked even after the error toast fades out.
  const [contactEmailInvalid, setContactEmailInvalid] = useState(false)
  // { id, name } when the user clicks the X on a contact row; cleared
  // when they confirm or cancel the ConfirmModal. `name` is the display
  // string shown in the confirmation copy (never `username`).
  const [contactToRemove, setContactToRemove] = useState(null)
  const [showPwModal, setShowPwModal] = useState(false)

  const updateMe = useUpdateMe()
  // Native time pickers on iOS / Android don't reliably blur the input
  // when dismissed, so we save on change with a small debounce instead.
  // The debounce also coalesces desktop spinner steps into one PATCH.
  const timeSaveTimer = useRef(null)
  useEffect(() => () => clearTimeout(timeSaveTimer.current), [])
  const { data: contacts = [] } = useContacts()
  const createContact = useCreateContact()
  const deleteContact = useDeleteContact()
  const reachable = useServerReachable()

  useEffect(() => {
    if (user) {
      const tz = user.timezone === 'UTC' ? Intl.DateTimeFormat().resolvedOptions().timeZone : user.timezone
      setForm({
        timezone: tz,
        daily_notification_time: (user.daily_notification_time || '08:00:00').slice(0, 5),
        quiet_hours_enabled: user.quiet_hours_enabled ?? false,
        quiet_hours_start: (user.quiet_hours_start || '22:00:00').slice(0, 5),
        quiet_hours_end: (user.quiet_hours_end || '07:00:00').slice(0, 5),
      })
      if (user.language && user.language !== i18n.language) {
        i18n.changeLanguage(user.language)
      }
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Generic autosave for the two fields without a dedicated form (timezone
  // and daily notification time). Matches the language pattern: the user
  // picks a value → it persists silently via `updateMe`. Only surface an
  // error toast when something actually goes wrong; success is implicit
  // (the UI already shows the new value the user just chose).
  const autosave = useCallback(
    (patch) => {
      updateMe.mutate(
        { patch, updatedAt: user?.settings_updated_at },
        {
          onError: (err) => {
            showToast({
              type: 'error',
              message: errorToastMessage(err, t, 'settings.errorSave'),
            })
          },
        },
      )
    },
    [updateMe, user?.settings_updated_at, showToast, t],
  )

  const togglePush = async () => {
    setPushLoading(true)
    try {
      if (pushSubscribed) {
        await unsubscribeFromPush()
        setPushSubscribed(false)
      } else {
        const permission = await Notification.requestPermission()
        setPushPermission(permission)
        if (permission !== 'granted') return
        const res = await api.get('/push/vapid-public-key/')
        const data = await res.json()
        if (!data.public_key) {
          alert(t('settings.pushNotConfigured'))
          return
        }
        await subscribeToPush(data.public_key)
        setPushSubscribed(true)
      }
    } catch (err) {
      console.error('Push toggle failed:', err)
      alert(t('settings.pushError'))
    } finally {
      setPushLoading(false)
    }
  }

  const changeLanguage = useCallback(
    (lng) => {
      i18n.changeLanguage(lng)
      autosave({ language: lng })
    },
    [i18n, autosave],
  )

  // True when the active quiet-hours range covers `daily_notification_time`.
  // Drives the inline error + inhibits the autosave path for either field
  // while the conflict is on the screen, so the backend never sees an
  // invalid combination.
  const dailyInQuietHours =
    form.quiet_hours_enabled &&
    isInQuietHours(form.daily_notification_time, form.quiet_hours_start, form.quiet_hours_end)

  const handleQuietHoursEnabled = useCallback(
    (enabled) => {
      const next = { ...form, quiet_hours_enabled: enabled }
      setForm(next)
      const wouldOverlap =
        enabled && isInQuietHours(next.daily_notification_time, next.quiet_hours_start, next.quiet_hours_end)
      if (!wouldOverlap) {
        autosave({ quiet_hours_enabled: enabled })
      }
    },
    [form, autosave],
  )

  const handleQuietHoursTimeChange = useCallback(
    (field, value) => {
      const next = { ...form, [field]: value }
      // Auto-disable when start === end: the range is empty, so the toggle
      // is dishonest if left on. Frontend collapses to disabled and sends
      // both fields in the same PATCH so the backend never sees an active
      // start === end pairing.
      const collapsedRange = next.quiet_hours_start === next.quiet_hours_end
      if (collapsedRange && next.quiet_hours_enabled) {
        next.quiet_hours_enabled = false
      }
      setForm(next)
      const wouldOverlap =
        next.quiet_hours_enabled &&
        isInQuietHours(next.daily_notification_time, next.quiet_hours_start, next.quiet_hours_end)
      if (wouldOverlap) return
      const payload = { [field]: value }
      if (next.quiet_hours_enabled !== form.quiet_hours_enabled) {
        payload.quiet_hours_enabled = next.quiet_hours_enabled
      }
      autosave(payload)
    },
    [form, autosave],
  )

  // Lightweight client-side gate. The backend still does the real
  // validation (404/400) — this just avoids round-trips on obvious typos.
  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

  const handleAddContact = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    const email = contactEmail.trim()
    if (!email) return
    if (!isValidEmail(email)) {
      showToast({ type: 'error', message: t('settings.addContact.errorEmail') })
      setContactEmailInvalid(true)
      return
    }
    try {
      await createContact.mutateAsync({ email })
      setContactEmail('')
      setContactEmailInvalid(false)
    } catch (err) {
      if (err instanceof OfflineError) {
        showToast({ type: 'error', message: t('offline.actionUnavailable') })
        // Offline isn't a "wrong email" — don't mark the input as invalid.
        return
      }
      // Distinguish the common cases via status + detail (server emits
      // descriptive strings via the contact_list_create view).
      const detail = err?.body?.detail || ''
      let message
      if (err?.status === 404) {
        message = t('settings.addContact.errorNotFound')
      } else if (/yourself/i.test(detail)) {
        message = t('settings.addContact.errorSelf')
      } else if (/already/i.test(detail)) {
        message = t('settings.addContact.errorAlready')
      } else {
        message = detail || t('common.actionError')
      }
      showToast({ type: 'error', message })
      setContactEmailInvalid(true)
    }
  }

  const confirmRemoveContact = async () => {
    const contactId = contactToRemove?.id
    setContactToRemove(null)
    if (contactId == null) return
    try {
      await deleteContact.mutateAsync({ contactId })
    } catch (err) {
      showToast({ type: 'error', message: errorToastMessage(err, t) })
    }
  }

  return (
    <div className={s.container}>
      <h1 className={shared.pageTitle}>{t('settings.title')}</h1>

      {!reachable && (
        <AlertBanner variant="warning" icon="wifi-off">
          {t('offline.settingsBlock')}
        </AlertBanner>
      )}

      <Section title={t('settings.profile')}>
        <div className={s.profileRow}>
          <span className={s.avatar} aria-hidden="true">
            {avatarInitial(user)}
          </span>
          <div className={s.profileMeta}>
            {/* Post-T197: render the display name and the email below as
             * secondary metadata. `username` is internal-only and never
             * surfaces in the UI. */}
            <h2 className={s.displayName}>{fullName(user)}</h2>
            {user?.email && <p className={shared.helpText}>{user.email}</p>}
          </div>
          <button
            type="button"
            className={shared.btnAdd}
            onClick={() => setShowPwModal(true)}
            aria-label={t('header.changePassword')}
            title={t('header.changePassword')}
          >
            <Icon name="user-key" />
          </button>
        </div>
      </Section>

      <Section title={t('settings.contacts')}>
        {contacts.length > 0 ? (
          <ul className={s.contactList} data-testid="contacts-list">
            {contacts.map((c) => (
              <li key={c.id} className={s.contactRow}>
                <span className={s.avatar} aria-hidden="true">
                  {avatarInitial(c)}
                </span>
                <span className={s.contactName}>
                  {fullName(c)}
                  {(c.first_name || c.last_name) && c.email && <span className={shared.helpText}> ({c.email})</span>}
                </span>
                <button
                  type="button"
                  className={cx(shared.btnIcon, shared.btnIconDelete, !reachable && shared.disabled)}
                  onClick={() => setContactToRemove({ id: c.id, name: fullName(c) })}
                  title={!reachable ? t('offline.requiresConnection') : t('settings.removeContact')}
                  aria-label={t('settings.removeContact')}
                  disabled={!reachable}
                >
                  <Icon name="x" size="sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={shared.helpText}>{t('settings.noContacts')}</p>
        )}

        <form className={s.addContactForm} onSubmit={handleAddContact} noValidate>
          <input
            className={cx(shared.input, contactEmailInvalid && s.inputInvalid)}
            type="email"
            placeholder={t('settings.addContact.email')}
            value={contactEmail}
            onChange={(e) => {
              setContactEmail(e.target.value)
              if (contactEmailInvalid) setContactEmailInvalid(false)
            }}
            disabled={!reachable}
            data-testid="add-contact-email"
          />
          <button
            type="submit"
            className={cx(shared.btnAdd, (!reachable || !contactEmail.trim()) && shared.disabled)}
            disabled={!reachable || !contactEmail.trim()}
            data-testid="add-contact-submit"
            aria-label={t('settings.addContact.add')}
            title={t('settings.addContact.add')}
          >
            <Icon name="plus" />
          </button>
        </form>
      </Section>

      <Section id="push" title={t('settings.push')} flash={flashId === 'push'}>
        <PushStatus
          permission={pushPermission}
          subscribed={pushSubscribed}
          loading={pushLoading}
          onToggle={togglePush}
          disabled={!reachable}
        />
      </Section>

      <Section title={t('settings.quietHours')}>
        <div className={s.quietHoursToggleRow}>
          <ToggleSwitch
            checked={form.quiet_hours_enabled}
            onChange={handleQuietHoursEnabled}
            ariaLabel={t('settings.quietHoursEnable')}
            disabled={!reachable}
          />
          <span className={s.quietHoursToggleLabel}>{t('settings.quietHoursEnable')}</span>
        </div>
        <p className={shared.helpText}>{t('settings.quietHoursHint')}</p>
        <div
          className={cx(s.quietHoursRange, !form.quiet_hours_enabled && s.quietHoursRangeDisabled)}
          data-testid="quiet-hours-range"
        >
          <label className={s.quietHoursField}>
            <span className={shared.helpText}>{t('settings.quietHoursStart')}</span>
            <input
              className={shared.input}
              type="time"
              value={form.quiet_hours_start}
              disabled={!form.quiet_hours_enabled || !reachable}
              onChange={(e) => handleQuietHoursTimeChange('quiet_hours_start', e.target.value)}
              data-testid="quiet-hours-start"
            />
          </label>
          <label className={s.quietHoursField}>
            <span className={shared.helpText}>{t('settings.quietHoursEnd')}</span>
            <input
              className={shared.input}
              type="time"
              value={form.quiet_hours_end}
              disabled={!form.quiet_hours_enabled || !reachable}
              onChange={(e) => handleQuietHoursTimeChange('quiet_hours_end', e.target.value)}
              data-testid="quiet-hours-end"
            />
          </label>
        </div>
        <p className={s.quietHoursNote}>
          <Info size={14} aria-hidden="true" />
          <span>{t('settings.quietHoursHintExtra')}</span>
        </p>
        {dailyInQuietHours && (
          <p className={cx(shared.helpText, s.error)} data-testid="quiet-hours-overlap-error">
            {t('settings.quietHoursOverlapError')}
          </p>
        )}
      </Section>

      <Section title={t('settings.dailyTime')}>
        <p className={shared.helpText}>{t('settings.dailyTimeHint')}</p>
        <input
          className={cx(shared.input, dailyInQuietHours && s.inputError)}
          type="time"
          value={form.daily_notification_time}
          onChange={(e) => {
            const next = e.target.value
            setForm((f) => ({ ...f, daily_notification_time: next }))
            clearTimeout(timeSaveTimer.current)
            timeSaveTimer.current = setTimeout(() => {
              // Snapshot of quiet hours at the time of change (form is captured
              // in closure). The toggle/range never moves inside the debounce
              // window, so this is safe.
              const wouldOverlap =
                form.quiet_hours_enabled && isInQuietHours(next, form.quiet_hours_start, form.quiet_hours_end)
              if (wouldOverlap) return
              if (next && next !== (user?.daily_notification_time || '').slice(0, 5)) {
                autosave({ daily_notification_time: next })
              }
            }, 500)
          }}
          disabled={!reachable}
        />
      </Section>

      <Section title={t('settings.language')}>
        <div className={s.langRow}>
          {LANGUAGES.map(({ code, labelKey }) => (
            <button
              key={code}
              type="button"
              className={cx(i18n.language === code ? s.langBtnActive : s.langBtn, !reachable && shared.disabled)}
              onClick={() => changeLanguage(code)}
              disabled={!reachable}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('settings.timezone')}>
        {form.timezone !== user?.timezone && user?.timezone === 'UTC' && (
          <p className={shared.helpText}>{t('settings.timezoneDetected', { tz: form.timezone })}</p>
        )}
        <Combobox
          value={form.timezone}
          onChange={(tz) => {
            setForm((f) => ({ ...f, timezone: tz }))
            if (tz && tz !== user?.timezone) autosave({ timezone: tz })
          }}
          options={TIMEZONES}
          placeholder={t('settings.timezoneSearch')}
          emptyMessage={t('settings.timezoneEmpty')}
          disabled={!reachable}
        />
      </Section>

      <InstallCard />

      {contactToRemove && (
        <ConfirmModal
          message={t('settings.confirmRemoveContact', { name: contactToRemove.name })}
          confirmLabel={t('settings.removeContact')}
          onConfirm={confirmRemoveContact}
          onCancel={() => setContactToRemove(null)}
        />
      )}
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}
      <p className={s.appVersion}>{import.meta.env.VITE_APP_VERSION ?? 'dev'}</p>
    </div>
  )
}

function PushStatus({ permission, subscribed, loading, onToggle, disabled = false }) {
  const { t } = useTranslation()
  const [testLoading, setTestLoading] = useState(false)
  const [testStatus, setTestStatus] = useState(null) // 'sent' | 'error'
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedStatus, setSchedStatus] = useState(null) // 'scheduled' | 'error'
  const [showTroubleshooting, setShowTroubleshooting] = useState(false)

  const active = permission === 'granted' && subscribed
  const denied = permission === 'denied'
  const canEnable = permission === 'granted' && !subscribed

  const dotClass = active ? shared.dotSuccess : canEnable ? shared.dotWarning : shared.dotDanger
  const labelText = active
    ? t('settings.pushActive')
    : denied
      ? t('settings.pushBlocked')
      : canEnable
        ? t('settings.pushGranted')
        : t('settings.pushNotEnabled')

  const sendTest = async () => {
    setTestLoading(true)
    setTestStatus(null)
    try {
      const res = await api.post('/push/test/', {})
      setTestStatus(res.ok ? 'sent' : 'error')
    } catch {
      setTestStatus('error')
    } finally {
      setTestLoading(false)
      setTimeout(() => setTestStatus(null), 3000)
    }
  }

  const scheduleTest = async () => {
    setSchedLoading(true)
    setSchedStatus(null)
    try {
      const res = await api.post('/push/test/scheduled/', {})
      setSchedStatus(res.ok ? 'scheduled' : 'error')
    } catch {
      setSchedStatus('error')
    } finally {
      setSchedLoading(false)
      setTimeout(() => setSchedStatus(null), 5000)
    }
  }

  return (
    <div className={s.pushWrap}>
      <div className={s.pushStatusRow}>
        <div className={s.pushRow}>
          <span className={cx(shared.dot, dotClass)} />
          <span className={s.pushLabel}>{labelText}</span>
        </div>

        {(canEnable || permission === 'default') && (
          <button
            className={cx(s.pushBtn, (loading || disabled) && shared.disabled)}
            type="button"
            onClick={onToggle}
            disabled={loading || disabled}
            title={disabled ? t('offline.requiresConnection') : undefined}
          >
            {loading ? '…' : t('settings.pushEnable')}
          </button>
        )}
      </div>

      {denied && <p className={shared.helpText}>{t('settings.pushHint')}</p>}

      {active && (
        <>
          <button
            className={cx(s.pushBtnGhost, (loading || disabled) && shared.disabled)}
            type="button"
            onClick={onToggle}
            disabled={loading || disabled}
            title={disabled ? t('offline.requiresConnection') : undefined}
          >
            {loading ? '…' : t('settings.pushDisable')}
          </button>
          <div className={s.troubleshootingSection}>
            <button
              type="button"
              className={shared.groupHeader}
              onClick={() => setShowTroubleshooting((v) => !v)}
              aria-expanded={showTroubleshooting}
              data-testid="push-troubleshooting-toggle"
            >
              <Icon name={showTroubleshooting ? 'chevron-down' : 'chevron-right'} size="sm" />
              <span>{t('settings.pushTroubleshooting')}</span>
            </button>
            {showTroubleshooting && (
              <div className={s.troubleshootingBody}>
                <p className={shared.helpText}>{t('settings.pushTroubleshootingHint')}</p>
                <button
                  className={cx(s.pushBtnGhost, (testLoading || disabled) && shared.disabled)}
                  type="button"
                  onClick={sendTest}
                  disabled={testLoading || disabled}
                  title={disabled ? t('offline.requiresConnection') : undefined}
                >
                  {testLoading
                    ? '…'
                    : testStatus === 'sent'
                      ? t('settings.pushTestSent')
                      : testStatus === 'error'
                        ? t('settings.pushTestError')
                        : t('settings.pushTestSend')}
                </button>
                <button
                  className={cx(s.pushBtnGhost, (schedLoading || disabled) && shared.disabled)}
                  type="button"
                  onClick={scheduleTest}
                  disabled={schedLoading || disabled}
                  title={disabled ? t('offline.requiresConnection') : undefined}
                >
                  {schedLoading
                    ? '…'
                    : schedStatus === 'scheduled'
                      ? t('settings.pushTestScheduled')
                      : schedStatus === 'error'
                        ? t('settings.pushTestError')
                        : t('settings.pushTestSchedule')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Section({ id, title, children, flash = false }) {
  return (
    <div id={id} className={cx(s.section, flash && s.flash)}>
      <p className={shared.sectionTitle}>{title}</p>
      {children}
    </div>
  )
}

function ToggleSwitch({ checked, onChange, ariaLabel, disabled = false }) {
  return (
    <label className={shared.formToggleSwitch}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className={shared.formToggleTrack}>
        <span className={shared.formToggleThumb} />
      </span>
    </label>
  )
}
