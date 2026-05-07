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
