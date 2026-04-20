import cx from '../utils/cx'
import Icon from './Icon'
import s from './AlertBanner.module.css'

export default function AlertBanner({ variant = 'warning', icon, children }) {
  const variantClass = variant === 'danger' ? s.danger : s.warning
  return (
    <div className={cx(s.banner, variantClass)} role="status">
      {icon && <Icon name={icon} size="sm" />}
      <span className={s.message}>{children}</span>
    </div>
  )
}
