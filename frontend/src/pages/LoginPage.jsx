import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import PasswordInput from '../components/PasswordInput'
import shared from '../styles/shared.module.css'
import s from './LoginPage.module.css'

const RESEND_COOLDOWN_SECONDS = 30

// Two-step wizard for /login. A third step ("name") is shown only for
// newly-created users so they can fill in first/last name before
// reaching the dashboard. The onboarding gate in ProtectedRoute
// re-routes here if a logged-in user with empty names somehow lands on
// a protected route — `isNewUser` then jumps the wizard straight to
// step 3 on mount.
export default function LoginPage() {
  const { loginStart, loginVerify, completeProfile, isNewUser, allowSelfSignup } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()

  const [step, setStep] = useState('email') // 'email' | 'otp' | 'password' | 'name'
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [otpFocused, setOtpFocused] = useState(false)

  // Returning logged-in-but-incomplete user (redirected here by the
  // onboarding gate in ProtectedRoute). Skip straight to the name step.
  useEffect(() => {
    if (isNewUser) setStep('name')
  }, [isNewUser])

  // Resend cooldown ticker — only active during the OTP step.
  useEffect(() => {
    if (step !== 'otp' || resendCooldown === 0) return
    const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000)
    return () => clearTimeout(timer)
  }, [step, resendCooldown])

  const reset = () => {
    setCode('')
    setPassword('')
    setError('')
    setInfo('')
  }

  const goBackToEmail = () => {
    setStep('email')
    reset()
  }

  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)
    try {
      const { method } = await loginStart(email)
      setResendCooldown(method === 'otp' ? RESEND_COOLDOWN_SECONDS : 0)
      setStep(method === 'password' ? 'password' : 'otp')
    } catch (err) {
      if (err?.message === 'user_not_found') setError(t('login.errorUserNotFound'))
      else if (err?.message === 'disposable_email') setError(t('login.errorDisposableEmail'))
      else if (err?.status === 429) setError(t('login.rateLimited'))
      else setError(t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  const finishLogin = async (payload) => {
    const { is_new } = await loginVerify(email, payload)
    if (is_new) {
      setStep('name')
    } else {
      navigate('/')
    }
  }

  // Single source for the OTP submit, used by both the form's onSubmit
  // (Enter key / Verify button) and the auto-submit on the 6th digit.
  // Takes an explicit `codeValue` because the auto-submit path calls in
  // from onChange where the React state hasn't committed yet.
  const submitOtp = async (codeValue) => {
    if (loading) return
    setError('')
    setLoading(true)
    try {
      await finishLogin({ code: codeValue })
    } catch (err) {
      if (err?.status === 429) setError(t('login.rateLimited'))
      else setError(t('login.codeInvalid'))
    } finally {
      setLoading(false)
    }
  }

  const handleOtpSubmit = (e) => {
    e.preventDefault()
    submitOtp(code)
  }

  const handleCodeChange = (e) => {
    const next = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(next)
    // Auto-verify once the 6th digit lands — covers both typing the
    // last char and pasting all six at once. The loading guard inside
    // `submitOtp` makes a duplicate click on Verify a no-op.
    if (next.length === 6) submitOtp(next)
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await finishLogin({ password })
    } catch (err) {
      if (err?.status === 429) setError(t('login.rateLimited'))
      else setError(t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (resendCooldown > 0) return
    setError('')
    setInfo('')
    try {
      await loginStart(email)
      setInfo(t('login.otpSent'))
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      if (err?.status === 429) setError(t('login.rateLimited'))
      else setError(t('login.error'))
    }
  }

  const handleNameSubmit = async (e) => {
    e.preventDefault()
    const first = firstName.trim()
    const last = lastName.trim()
    if (!first || !last) {
      setError(t('login.namesRequired'))
      return
    }
    setError('')
    setLoading(true)
    try {
      await completeProfile(first, last)
      navigate('/')
    } catch {
      setError(t('login.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={s.page}>
      <div className={s.card}>
        <img src="/icons/source.svg" alt="Nudge" className={s.logoImg} />
        <p className={s.tagline}>{t('login.tagline')}</p>

        {step === 'email' && (
          <form onSubmit={handleEmailSubmit} className={s.form}>
            {allowSelfSignup === true && <h2 className={s.stepTitle}>{t('login.signInOrRegister')}</h2>}
            {allowSelfSignup === false && <h2 className={s.stepTitle}>{t('login.signIn')}</h2>}
            <input
              className={shared.input}
              type="email"
              placeholder={t('login.email')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <p className={shared.error}>{error}</p>}
            <button className={s.btn} type="submit" disabled={loading}>
              {loading ? t('login.submitting') : t('login.continue')}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleOtpSubmit} className={s.form}>
            <h2 className={s.stepTitle}>{t('login.checkEmail')}</h2>
            <p className={shared.helpText}>{t('login.checkEmailHint', { email })}</p>
            <div className={s.otpWrap}>
              <input
                className={s.otpHiddenInput}
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder={t('login.code')}
                aria-label={t('login.code')}
                value={code}
                onChange={handleCodeChange}
                onFocus={() => setOtpFocused(true)}
                onBlur={() => setOtpFocused(false)}
                required
                autoFocus
              />
              <div className={s.otpSlots} aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => {
                  const isActive = otpFocused && i === code.length
                  const cls = [s.otpSlot, isActive && s.otpSlotActive].filter(Boolean).join(' ')
                  return (
                    <div key={i} className={cls}>
                      {code[i] || ''}
                    </div>
                  )
                })}
              </div>
            </div>
            {error && <p className={shared.error}>{error}</p>}
            {info && <p className={shared.helpText}>{info}</p>}
            <button className={s.btn} type="submit" disabled={loading || code.length !== 6}>
              {loading ? t('login.submitting') : t('login.verify')}
            </button>
            <button type="button" className={s.linkBtn} onClick={handleResend} disabled={resendCooldown > 0}>
              {resendCooldown > 0 ? t('login.resendIn', { seconds: resendCooldown }) : t('login.resend')}
            </button>
            <button type="button" className={s.linkBtn} onClick={goBackToEmail}>
              {t('login.back')}
            </button>
          </form>
        )}

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className={s.form}>
            <h2 className={s.stepTitle}>{t('login.welcomeBack')}</h2>
            <PasswordInput
              placeholder={t('login.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
            {error && <p className={shared.error}>{error}</p>}
            <button className={s.btn} type="submit" disabled={loading || password.length === 0}>
              {loading ? t('login.submitting') : t('login.submit')}
            </button>
            <button type="button" className={s.linkBtn} onClick={goBackToEmail}>
              {t('login.back')}
            </button>
          </form>
        )}

        {step === 'name' && (
          <form onSubmit={handleNameSubmit} className={s.form}>
            <h2 className={s.stepTitle}>{t('login.completeProfile')}</h2>
            <p className={shared.helpText}>{t('login.completeProfileHint')}</p>
            <input
              className={shared.input}
              type="text"
              placeholder={t('login.firstName')}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoFocus
            />
            <input
              className={shared.input}
              type="text"
              placeholder={t('login.lastName')}
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
            {error && <p className={shared.error}>{error}</p>}
            <button className={s.btn} type="submit" disabled={loading || !firstName.trim() || !lastName.trim()}>
              {loading ? t('login.submitting') : t('login.continue')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
