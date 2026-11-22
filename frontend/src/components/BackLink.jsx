import { Link } from 'react-router-dom'
import buttons from '../styles/buttons.module.css'
import cx from '../utils/cx'
import Icon from './Icon'
import s from './BackLink.module.css'

/**
 * «Back to …» at the top of a screen: a drawn arrow at icon size, since a text
 * «←» renders tiny on phones. A link with `to`, a button with `onClick`.
 */
export default function BackLink({ to, onClick, children }) {
  const className = cx(buttons.btn, buttons.text, s.back)
  const content = (
    <>
      <Icon name="arrow-left" size="lg" />
      <span>{children}</span>
    </>
  )
  if (to) {
    return (
      <Link to={to} className={className}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" className={className} onClick={onClick}>
      {content}
    </button>
  )
}
