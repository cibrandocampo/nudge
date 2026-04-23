import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { OfflineError } from '../api/errors'
import { useAuth } from '../contexts/AuthContext'
import { useContacts, useContactSearch } from '../hooks/useContacts'
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
import { useToast } from '../components/useToast'
import { subscribeToPush, unsubscribeFromPush } from '../utils/push'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './SettingsPage.module.css'

const TIMEZONES = Intl.supportedValuesOf('timeZone')

const LANGUAGES = [
  { code: 'en', labelKey: 'settings.languageEn' },
  { code: 'es', labelKey: 'settings.languageEs' },
  { code: 'gl', labelKey: 'settings.languageGl' },
]

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [form, setForm] = useState(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    daily_notification_time: '08:00',
  }))

  const {
    permission: pushPermission,
    subscribed: pushSubscribed,
    setPermission: setPushPermission,
    setSubscribed: setPushSubscribed,
  } = usePushStatus()
  const [pushLoading, setPushLoading] = useState(false)

  const [contactQuery, setContactQuery] = useState('')
  const [contactError, setContactError] = useState('')
  // { id, username } when the user clicks the X on a contact row; cleared
  // when they confirm or cancel the ConfirmModal.
  const [contactToRemove, setContactToRemove] = useState(null)
  const [showPwModal, setShowPwModal] = useState(false)

  const updateMe = useUpdateMe()
  const { data: contacts = [] } = useContacts()
  const createContact = useCreateContact()
  const deleteContact = useDeleteContact()
  const { data: searchResults = [] } = useContactSearch(contactQuery)
  const reachable = useServerReachable()

  useEffect(() => {
    if (user) {
      const tz = user.timezone === 'UTC' ? Intl.DateTimeFormat().resolvedOptions().timeZone : user.timezone
      setForm({
        timezone: tz,
        daily_notification_time: (user.daily_notification_time || '08:00:00').slice(0, 5),
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
              message: err instanceof OfflineError ? t('offline.actionUnavailable') : t('settings.errorSave'),
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

  const handleAddContact = async (contactUser) => {
    setContactError('')
    try {
      await createContact.mutateAsync({ username: contactUser.username })
      setContactQuery('')
    } catch (err) {
      if (err instanceof OfflineError) {
        setContactError(t('offline.actionUnavailable'))
      } else {
        setContactError(err?.body?.detail || t('common.actionError'))
      }
    }
  }

  const confirmRemoveContact = async () => {
    const contactId = contactToRemove?.id
    setContactToRemove(null)
    if (contactId == null) return
    setContactError('')
    try {
      await deleteContact.mutateAsync({ contactId })
    } catch (err) {
      setContactError(err instanceof OfflineError ? t('offline.actionUnavailable') : t('common.actionError'))
    }
  }

  const visibleSearchResults = contactQuery.length >= 2 ? searchResults : []

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
            {(user?.first_name || user?.username || '?').charAt(0).toUpperCase()}
          </span>
          <div className={s.profileMeta}>
            {/* Show "First Last (username)" when names exist; fall back to
              * just the username. The "(username)" tail is rendered in the
              * helpText style so it reads as secondary. */}
            {user?.first_name || user?.last_name ? (
              <h2 className={s.username}>
                {[user.first_name, user.last_name].filter(Boolean).join(' ')}
                <span className={shared.helpText}> ({user.username})</span>
              </h2>
            ) : (
              <h2 className={s.username}>{user?.username}</h2>
            )}
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
                  {c.username.charAt(0).toUpperCase()}
                </span>
                <span className={s.contactName}>{c.username}</span>
                <button
                  type="button"
                  className={cx(shared.btnIcon, shared.btnIconDelete, !reachable && shared.disabled)}
                  onClick={() => setContactToRemove({ id: c.id, username: c.username })}
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

        <Combobox
          value=""
          onChange={handleAddContact}
          options={visibleSearchResults}
          getLabel={(u) => u.username}
          getKey={(u) => u.id}
          placeholder={t('settings.searchUsers')}
          emptyMessage={t('settings.contactNotFound')}
          onInputChange={setContactQuery}
          disabled={!reachable}
        />

        {contactError && <p className={cx(shared.helpText, s.error)}>{contactError}</p>}
      </Section>

      <Section title={t('settings.push')}>
        <PushStatus
          permission={pushPermission}
          subscribed={pushSubscribed}
          loading={pushLoading}
          onToggle={togglePush}
          disabled={!reachable}
        />
      </Section>

      <Section title={t('settings.dailyTime')}>
        <p className={shared.helpText}>{t('settings.dailyTimeHint')}</p>
        <input
          className={shared.input}
          type="time"
          value={form.daily_notification_time}
          onChange={(e) => setForm((f) => ({ ...f, daily_notification_time: e.target.value }))}
          onBlur={(e) => {
            const next = e.target.value
            if (next && next !== (user?.daily_notification_time || '').slice(0, 5)) {
              autosave({ daily_notification_time: next })
            }
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

      {contactToRemove && (
        <ConfirmModal
          message={t('settings.confirmRemoveContact', { name: contactToRemove.username })}
          confirmLabel={t('settings.removeContact')}
          onConfirm={confirmRemoveContact}
          onCancel={() => setContactToRemove(null)}
        />
      )}
      {showPwModal && <ChangePasswordModal onClose={() => setShowPwModal(false)} />}
    </div>
  )
}

function PushStatus({ permission, subscribed, loading, onToggle, disabled = false }) {
  const { t } = useTranslation()
  const [testLoading, setTestLoading] = useState(false)
  const [testStatus, setTestStatus] = useState(null) // 'sent' | 'error'
  const [schedLoading, setSchedLoading] = useState(false)
  const [schedStatus, setSchedStatus] = useState(null) // 'scheduled' | 'error'

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
        </>
      )}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className={s.section}>
      <p className={shared.sectionTitle}>{title}</p>
      {children}
    </div>
  )
}
