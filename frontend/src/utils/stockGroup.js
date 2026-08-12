// Pre-T176 the API mutated `stock.group` to the viewer's personal override
// when the viewer was not the owner. After T176 the shape is explicit:
//
//   - `group` / `group_name`     — always the owner's stock.group (or null).
//   - `my_group` / `my_group_name` — viewer's personal override (or null).
//
// The UI keeps the legacy "override pisa al grupo del owner" behaviour by
// reading `my_group ?? group`. This helper centralises the fallback so every
// call site stays aligned if the rule ever changes.

export function effectiveGroupId(stock) {
  if (!stock) return null
  return stock.my_group ?? stock.group ?? null
}

/**
 * The name that goes with `effectiveGroupId`.
 *
 * Deliberately branches on `my_group` rather than falling back through
 * `my_group_name ?? group_name`: the two would disagree if a viewer's override
 * ever arrived with an id but no name, and the id is what decides which group
 * the stock is in.
 */
export function effectiveGroupName(stock) {
  if (!stock) return null
  return (stock.my_group != null ? stock.my_group_name : stock.group_name) ?? null
}
