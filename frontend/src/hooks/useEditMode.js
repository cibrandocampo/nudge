import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * «Edit» mode of a list section (T153, UX-036): at rest the rows show no
 * destructive actions; editing reveals them. One pattern for every list that
 * can lose rows — a product's lots, contacts, categories (T154).
 *
 * The mode ends on its own when the page changes and when the list runs out
 * of rows (there is nothing left to edit, and an empty list must not stay in
 * a mode its toggle no longer shows).
 *
 * Pair it with `EditToggle` in the section header and pass `editing` to the
 * list.
 *
 * @param {{ count: number }} opts  how many rows the list has now
 * @returns {{ editing: boolean, toggle: () => void }}
 */
export function useEditMode({ count }) {
  const [editing, setEditing] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    setEditing(false)
  }, [pathname])

  useEffect(() => {
    if (count === 0) setEditing(false)
  }, [count])

  return { editing, toggle: () => setEditing((on) => !on) }
}
