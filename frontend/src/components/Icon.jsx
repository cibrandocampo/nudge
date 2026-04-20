/**
 * Thin wrapper around the public/icons.svg sprite.
 *
 * Usage:
 *   <Icon name="check" />           // 16px
 *   <Icon name="plus" size="sm" />  // 14px
 *   <Icon name="user" size="lg" />  // 20px
 *   <Icon name="check" className={s.ok} />
 *
 * `name` must match a `<symbol id="i-NAME">` in public/icons.svg.
 * Colour comes from `currentColor` — set `color` on the parent.
 */

const SIZE_CLASS = {
  sm: 'icon-sm',
  lg: 'icon-lg',
  md: '',
}

export default function Icon({ name, size = 'md', className = '', ...rest }) {
  const sizeCls = SIZE_CLASS[size] ?? ''
  const classes = ['icon', sizeCls, className].filter(Boolean).join(' ')
  return (
    <svg className={classes} aria-hidden="true" focusable="false" {...rest}>
      <use href={`/icons.svg#i-${name}`} />
    </svg>
  )
}
