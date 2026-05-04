import cx from '../utils/cx'
import Icon from './Icon'
import s from './AlertBanner.module.css'

export default function AlertBanner({ variant = 'warning', icon, onClick, children }) {
  const variantClass = variant === 'danger' ? s.danger : s.warning
  const className = cx(s.banner, variantClass, onClick && s.clickable)

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {icon && <Icon name={icon} size="sm" />}
        <span className={s.message}>{children}</span>
        <Icon name="chevron-right" size="sm" />
      </button>
    )
  }

  return (
    <div className={className} role="status">
      {icon && <Icon name={icon} size="sm" />}
      <span className={s.message}>{children}</span>
    </div>
  )
}
