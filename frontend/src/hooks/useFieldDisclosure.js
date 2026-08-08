import { useState } from 'react'

/**
 * Progressive disclosure for form fields that start folded.
 *
 * Registering a box is four fields, of which two are usually empty. Quantity
 * and expiry are always on screen; the batch number and the serial start hidden
 * and are revealed on demand, or by a scan that fills them.
 *
 * **Visibility is event-driven, not derived.** "Visible if it has a value"
 * describes the state at well-defined moments, not a continuous binding —
 * binding it to the value would make a field vanish mid-typing the instant the
 * user empties it, which is the worst possible behaviour for a text input. So
 * the flags live here and change only on these events:
 *
 * | Event         | Result                                                    |
 * |---------------|-----------------------------------------------------------|
 * | Initial       | Everything folded                                          |
 * | `reveal(name)`| That one field opens — a scan filled it. Never the reverse |
 * | `revealAll()` | Every field folded *at that moment* opens, one or two      |
 * | `reset()`     | Back to folded; the form closed                            |
 *
 * Once revealed, a field only folds again on `reset()`.
 *
 * Shared rather than inlined because `AddLotForm` and `StockFormPage`'s initial
 * batch rows follow the same rule with different layouts — the rule travels,
 * the markup does not.
 *
 * @param names the fields that can be folded, e.g. `['lot', 'serial']`
 */
export function useFieldDisclosure(names) {
  const [revealed, setRevealed] = useState({})

  return {
    isRevealed: (name) => Boolean(revealed[name]),
    // `hasHidden` is what decides whether the reveal control is worth showing:
    // once nothing is folded there is nothing left to add.
    hasHidden: names.some((name) => !revealed[name]),
    reveal: (name) => setRevealed((prev) => ({ ...prev, [name]: true })),
    revealAll: () => setRevealed(Object.fromEntries(names.map((name) => [name, true]))),
    reset: () => setRevealed({}),
  }
}
