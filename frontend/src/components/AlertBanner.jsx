import cx from '../utils/cx'
import Icon from './Icon'
import s from './AlertBanner.module.css'

export default function AlertBanner({ variant = 'warning', icon, onClick, children }) {
  const variantClass = variant === 'danger' ? s.danger : s.warning
  // No clickable modifier: the stylesheet reaches the interactive case through
  // `button.banner`, so the element being a <button> is what carries cursor,
  // hover and active. A class here would have to be kept in sync for nothing.
  const className = cx(s.banner, variantClass)

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
