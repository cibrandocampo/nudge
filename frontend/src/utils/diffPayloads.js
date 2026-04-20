/**
 * Compute the list of fields that differ between a local (about-to-be-
 * saved) mutation payload and the server's current version of the same
 * resource. Used by `ConflictModal` (T066) to render a legible side-by-
 * side instead of dumping raw JSON.
 *
 * The comparison is structural via `JSON.stringify` — enough for the
 * primitives (strings, numbers, booleans) and the small arrays of ids
 * that our mutation payloads carry (shared_with, lot_selections…).
 *
 * Fields present on only one side are SKIPPED: the server's response
 * always carries computed fields (`quantity`, `is_owner`, …) that the
 * PATCH body doesn't set, and surfacing those would confuse the user.
 */
export function diffPayloads(local, server) {
  if (!local || !server) return []
  const diffs = []
  for (const key of Object.keys(local)) {
    if (!(key in server)) continue
    const lv = local[key]
    const sv = server[key]
    if (!stableEquals(lv, sv)) {
      diffs.push({ field: key, localValue: lv, serverValue: sv })
    }
  }
  return diffs
}

function stableEquals(a, b) {
  // Fast path for primitives and same-reference values.
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}
