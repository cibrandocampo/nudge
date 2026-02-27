import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { subscribeToPush, unsubscribeFromPush } from '../utils/push'
import cx from '../utils/cx'
import shared from '../styles/shared.module.css'
import s from './SettingsPage.module.css'

const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'Europe/Madrid', 'Europe/London', 'America/New_York', 'America/Los_Angeles']

const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

const LANGUAGES = [
  { code: 'en', labelKey: 'settings.languageEn' },
  { code: 'es', labelKey: 'settings.languageEs' },
  { code: 'gl', labelKey: 'settings.languageGl' },
]

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()

  const [form, setForm] = useState({ timezone: BROWSER_TZ, daily_notification_time: '08:00' })
  const [tzFilter, setTzFilter] = useState('')
  const selectRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)

  const [pushPermission, setPushPermission] = useState('Notification' in window ? Notification.permission : 'denied')
  const [pushSubscribed, setPushSubscribed] = useState(false)
  const [pushLoading, setPushLoading] = useState(false)

  useEffect(() => {
    if (user) {
      // If timezone is still the default 'UTC', pre-fill with browser timezone
      const tz = user.timezone === 'UTC' ? BROWSER_TZ : user.timezone
      setForm({
        timezone: tz,
        daily_notification_time: (user.daily_notification_time || '08:00:00').slice(0, 5),
      })
      if (user.language && user.language !== i18n.language) {
        i18n.changeLanguage(user.language)
      }
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setPushSubscribed(Boolean(sub)))
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    const res = await api.patch('/auth/me/', form)
    setSaving(false)
    setSaveStatus(res.ok ? 'saved' : 'error')
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
      api.patch('/auth/me/', { language: lng })
    },
    [i18n],
  )

  const filteredTz = tzFilter ? TIMEZONES.filter((tz) => tz.toLowerCase().includes(tzFilter.toLowerCase())) : TIMEZONES

  // Scroll the native <select> so the selected option is visible
  useEffect(() => {
    const el = selectRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      const idx = filteredTz.indexOf(form.timezone)
      if (idx >= 0) el.selectedIndex = idx
    })
    return () => cancelAnimationFrame(raf)
  }, [form.timezone, filteredTz])

  return (
    <div className={s.container}>
      <h1 className={shared.pageTitle}>{t('settings.title')}</h1>

      <form onSubmit={handleSave} className={s.form}>
        <Section title={t('settings.profile')}>
          <p className={s.username}>{user?.username}</p>
        </Section>

        <Section title={t('settings.language')}>
          <div className={s.langRow}>
            {LANGUAGES.map(({ code, labelKey }) => (
              <button
                key={code}
                type="button"
                className={i18n.language === code ? s.langBtnActive : s.langBtn}
                onClick={() => changeLanguage(code)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </Section>

        <Section title={t('settings.timezone')}>
          {form.timezone !== user?.timezone && user?.timezone === 'UTC' && (
            <p className={s.tzHint}>{t('settings.timezoneDetected', { tz: BROWSER_TZ })}</p>
          )}
          <input
            className={shared.input}
            placeholder={t('settings.timezoneSearch')}
            value={tzFilter}
            onChange={(e) => setTzFilter(e.target.value)}
          />
          <select
            ref={selectRef}
            className={cx(shared.input, s.listbox)}
            size={5}
            value={form.timezone}
            onChange={(e) => {
              setForm((f) => ({ ...f, timezone: e.target.value }))
              setTzFilter('')
            }}
          >
            {filteredTz.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Section>

        <Section title={t('settings.dailyTime')}>
          <p className={s.hint}>{t('settings.dailyTimeHint')}</p>
          <input
            className={cx(shared.input, s.inputTime)}
            type="time"
            value={form.daily_notification_time}
            onChange={(e) => setForm((f) => ({ ...f, daily_notification_time: e.target.value }))}
          />
        </Section>

        <button type="submit" className={s.saveBtn} disabled={saving}>
          {saving
            ? t('settings.saving')
            : saveStatus === 'saved'
              ? t('settings.saved')
              : saveStatus === 'error'
                ? t('settings.errorSave')
                : t('settings.saveChanges')}
        </button>
      </form>

      <hr className={s.divider} />

      <Section title={t('settings.push')}>
        <PushStatus
          permission={pushPermission}
          subscribed={pushSubscribed}
          loading={pushLoading}
          onToggle={togglePush}
        />
      </Section>
    </div>
  )
}

function PushStatus({ permission, subscribed, loading, onToggle }) {
  const { t } = useTranslation()
  const [testLoading, setTestLoading] = useState(false)
  const [testStatus, setTestStatus] = useState(null) // 'sent' | 'error'

  const active = permission === 'granted' && subscribed
  const denied = permission === 'denied'
  const canEnable = permission === 'granted' && !subscribed

  const dotClass = active ? s.pushDotActive : denied ? s.pushDotDenied : s.pushDotDefault
  const labelClass = active ? s.pushLabelActive : denied ? s.pushLabelDenied : s.pushLabelDefault
  const labelText = active
    ? t('settings.pushActive')
    : denied
      ? t('settings.pushBlocked')
      : permission === 'granted'
        ? t('settings.pushGranted')
        : t('settings.pushNotEnabled')

  const sendTest = async () => {
    setTestLoading(true)
    setTestStatus(null)
    try {
      const res = await api.post('/push/test/', {})
      setTestStatus(res.ok || res.status === 204 ? 'sent' : 'error')
    } catch {
      setTestStatus('error')
    } finally {
      setTestLoading(false)
      setTimeout(() => setTestStatus(null), 3000)
    }
  }

  return (
    <div className={s.pushWrap}>
      <div className={s.pushRow}>
        <span className={cx(s.pushDot, dotClass)} />
        <span className={cx(s.pushLabel, labelClass)}>{labelText}</span>
      </div>

      {denied && <p className={s.pushHint}>{t('settings.pushHint')}</p>}

      {(canEnable || permission === 'default') && (
        <button
          className={cx(s.pushBtn, loading && shared.disabled)}
          type="button"
          onClick={onToggle}
          disabled={loading}
        >
          {loading ? '…' : t('settings.pushEnable')}
        </button>
      )}

      {active && (
        <>
          <button
            className={cx(s.pushBtnGhost, loading && shared.disabled)}
            type="button"
            onClick={onToggle}
            disabled={loading}
          >
            {loading ? '…' : t('settings.pushDisable')}
          </button>
          <button
            className={cx(s.pushBtnGhost, testLoading && shared.disabled)}
            type="button"
            onClick={sendTest}
            disabled={testLoading}
          >
            {testLoading
              ? '…'
              : testStatus === 'sent'
                ? t('settings.pushTestSent')
                : testStatus === 'error'
                  ? t('settings.pushTestError')
                  : t('settings.pushTestSend')}
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
