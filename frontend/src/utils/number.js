export function parseIntSafe(value, fallback = 0) {
  if (value === null || value === undefined) return fallback
  const parsed = Number.parseInt(String(value).trim(), 10)
  return Number.isNaN(parsed) ? fallback : parsed
}
