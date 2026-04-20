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
import Combobox from '../components/Combobox'
import Icon from '../components/Icon'
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

  const [form, setForm] = useState(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    daily_notification_time: '08:00',
  }))
  const [saveStatus, setSaveStatus] = useState(null)

  const {
    permission: pushPermission,
    subscribed: pushSubscribed,
    setPermission: setPushPermission,
    setSubscribed: setPushSubscribed,
  } = usePushStatus()
  const [pushLoading, setPushLoading] = useState(false)

  const [contactQuery, setContactQuery] = useState('')
  const [contactError, setContactError] = useState('')

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

  const handleSave = async (e) => {
    e.preventDefault()
    try {
      const result = await updateMe.mutateAsync({ patch: form, updatedAt: user?.settings_updated_at })
      setSaveStatus(result?.__queued ? 'queued' : 'saved')
    } catch (err) {
      setSaveStatus(err instanceof OfflineError ? 'offline' : 'error')
    }
    setTimeout(() => setSaveStatus(null), 2500)
  }

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
      updateMe.mutate({ patch: { language: lng }, updatedAt: user?.settings_updated_at })
    },
    [i18n, updateMe, user?.settings_updated_at],
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

  const handleRemoveContact = async (contactId) => {
    if (!window.confirm(t('settings.confirmRemoveContact'))) return
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
        <h2 className={s.username}>{user?.username}</h2>
        {user?.email && <p className={shared.helpText}>{user.email}</p>}
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
                  onClick={() => handleRemoveContact(c.id)}
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

      <form onSubmit={handleSave} className={s.form}>
        <Section title={t('settings.dailyTime')}>
          <div className={s.inlineField}>
            <input
              className={cx(shared.input, s.inputTime)}
              type="time"
              value={form.daily_notification_time}
              onChange={(e) => setForm((f) => ({ ...f, daily_notification_time: e.target.value }))}
              disabled={!reachable}
            />
            <p className={shared.helpText}>{t('settings.dailyTimeHint')}</p>
          </div>
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
            onChange={(tz) => setForm((f) => ({ ...f, timezone: tz }))}
            options={TIMEZONES}
            placeholder={t('settings.timezoneSearch')}
            emptyMessage={t('settings.timezoneEmpty')}
            disabled={!reachable}
          />
        </Section>

        <button type="submit" className={s.saveBtn} disabled={updateMe.isPending || !reachable}>
          {updateMe.isPending
            ? t('settings.saving')
            : saveStatus === 'saved'
              ? t('settings.saved')
              : saveStatus === 'offline'
                ? t('offline.actionUnavailable')
                : saveStatus === 'error'
                  ? t('settings.errorSave')
                  : t('settings.saveChanges')}
        </button>
      </form>
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
      <div className={s.pushRow}>
        <span className={cx(shared.dot, dotClass)} />
        <span className={s.pushLabel}>{labelText}</span>
      </div>

      {denied && <p className={shared.helpText}>{t('settings.pushHint')}</p>}

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
