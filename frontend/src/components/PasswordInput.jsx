import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import shared from '../styles/shared.module.css'
import s from './PasswordInput.module.css'

export default function PasswordInput({ className, ...props }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <div className={s.wrapper}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${shared.input} ${s.input} ${className ?? ''}`}
      />
      <button
        type="button"
        className={s.toggle}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
        tabIndex={-1}
      >
        {visible ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        )}
      </button>
    </div>
  )
}
