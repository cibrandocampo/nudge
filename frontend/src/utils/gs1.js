/**
 * GS1 barcode parsing.
 *
 * Every medicine box sold in the EU carries a GS1 DataMatrix (mandatory since
 * 2019 under the Falsified Medicines Directive) holding the product code, the
 * expiry date, the batch/lot number and a serial unique to that physical pack.
 * This module turns the decoder's raw output into the fields the add-lot form
 * needs.
 *
 * Pure and synchronous by design: no React, no I/O, no side effects. It runs on
 * the client because the app is offline-first — scanning must work with no
 * network.
 *
 * Three input shapes produce the same result:
 *   - the raw element string, GS-separated  (what a camera decode returns)
 *   - the human-readable form  `(01)09506000134376(17)280430`  (pasted by hand)
 *   - a GS1 Digital Link URI  `https://id.gs1.org/01/…/10/…?17=…`
 */

/** FNC1 surfaces in decoded text as GS, ASCII 29. */
const GS = '\u001d'

/**
 * Application Identifiers with a predefined length: their value is read by
 * character count and is NOT followed by a separator, so the next AI starts
 * immediately. Values are data lengths, excluding the AI itself.
 */
const FIXED_LENGTH = {
  '00': 18,
  '01': 14,
  '02': 14,
  '03': 14,
  '04': 16,
  11: 6,
  12: 6,
  13: 6,
  14: 6,
  15: 6,
  16: 6,
  17: 6,
  18: 6,
  19: 6,
  20: 2,
}

/** Variable-length AIs: the value runs to the next GS, or to end of string. */
const VARIABLE_LENGTH = new Set([
  '10',
  '21',
  '22',
  '30',
  '37',
  '240',
  '241',
  '242',
  '250',
  '251',
  '253',
  '254',
  '710',
  '711',
  '712',
  '713',
  '714',
  '715',
  '716',
])

/** National Healthcare Reimbursement Numbers (712 is the Spanish CN). */
const NHRN_AIS = ['710', '711', '712', '713', '714', '715', '716']

const SYMBOLOGY_IDENTIFIERS = [']d2', ']d1', ']C1', ']e0']

/**
 * Validates a GTIN-14 with its mod-10 check digit: from the right of the first
 * 13 digits, multiply alternately by 3 and 1 starting with 3.
 */
export function isValidGtin(gtin) {
  if (!/^\d{14}$/.test(gtin)) return false
  let sum = 0
  for (let i = 0; i < 13; i += 1) {
    const digit = Number(gtin[12 - i])
    sum += i % 2 === 0 ? digit * 3 : digit
  }
  return (10 - (sum % 10)) % 10 === Number(gtin[13])
}

/**
 * Converts a GS1 `YYMMDD` date to `YYYY-MM-DD`, or null when it is not a usable
 * date.
 *
 * Two rules that are easy to get wrong:
 *   - the century is the one that places the date within roughly -49/+50 years
 *     of today;
 *   - a day of `00` means "the last day of that month", leap years included.
 *     GS1 declared it non-compliant from January 2025, but packs printed
 *     earlier stay in circulation for years.
 */
export function parseGs1Date(value, today = new Date()) {
  if (!/^\d{6}$/.test(value)) return null
  const yy = Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  if (month < 1 || month > 12) return null

  const currentYear = today.getFullYear()
  let year = Math.floor(currentYear / 100) * 100 + yy
  if (year - currentYear > 50) year -= 100
  else if (year - currentYear < -49) year += 100

  // Day 0 of the following month is the last day of this one.
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > lastDayOfMonth) return null
  const resolvedDay = day === 0 ? lastDayOfMonth : day

  const pad = (n) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(resolvedDay)}`
}

/** Reads the AI at `index`, longest known match first. */
function readAi(input, index) {
  for (const length of [4, 3, 2]) {
    const candidate = input.slice(index, index + length)
    if (candidate.length === length && (candidate in FIXED_LENGTH || VARIABLE_LENGTH.has(candidate))) {
      return candidate
    }
  }
  return null
}

/**
 * Walks a raw element string into `[ai, value]` pairs.
 *
 * On an unknown AI it stops and returns the remainder as `unparsed` instead of
 * guessing a length — guessing is how parsers silently corrupt data.
 */
function parseElementString(input) {
  const pairs = []
  let i = 0
  while (i < input.length) {
    if (input[i] === GS) {
      i += 1
      continue
    }
    const ai = readAi(input, i)
    if (ai === null) return { pairs, unparsed: input.slice(i) }
    i += ai.length

    let value
    if (ai in FIXED_LENGTH) {
      const length = FIXED_LENGTH[ai]
      value = input.slice(i, i + length)
      // A truncated fixed-length field means the symbol was misread.
      if (value.length < length) return { pairs, unparsed: input.slice(i - ai.length) }
      i += length
    } else {
      const end = input.indexOf(GS, i)
      value = end === -1 ? input.slice(i) : input.slice(i, end)
      i = end === -1 ? input.length : end + 1
    }
    pairs.push([ai, value])
  }
  return { pairs, unparsed: '' }
}

/** Parses the human-readable form `(01)09506000134376(17)280430`. */
function parseHumanReadable(input) {
  const pairs = []
  const pattern = /\((\d{2,4})\)([^(]*)/g
  let match = pattern.exec(input)
  while (match !== null) {
    pairs.push([match[1], match[2]])
    match = pattern.exec(input)
  }
  return { pairs, unparsed: '' }
}

/** Parses a GS1 Digital Link URI: `/01/<gtin>/10/<lot>?17=…&21=…`. */
function parseDigitalLink(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    return { pairs: [], unparsed: input }
  }
  const pairs = []
  const segments = url.pathname.split('/').filter(Boolean)
  // Ignore any path prefix before the first AI segment.
  const start = segments.findIndex((segment) => /^\d{2,4}$/.test(segment))
  if (start !== -1) {
    for (let i = start; i + 1 < segments.length; i += 2) {
      if (!/^\d{2,4}$/.test(segments[i])) break
      pairs.push([segments[i], decodeURIComponent(segments[i + 1])])
    }
  }
  url.searchParams.forEach((value, key) => {
    if (/^\d{2,4}$/.test(key)) pairs.push([key, value])
  })
  return { pairs, unparsed: '' }
}

function normalise(raw) {
  let input = raw.trim()
  for (const identifier of SYMBOLOGY_IDENTIFIERS) {
    if (input.startsWith(identifier)) {
      input = input.slice(identifier.length)
      break
    }
  }
  while (input.startsWith(GS)) input = input.slice(1)
  return input
}

/**
 * Parses a scanned GS1 payload.
 *
 * @param {string} raw - decoded barcode content, GS separators preserved.
 * @returns {null | {
 *   gtin: string | null,
 *   lotNumber: string | null,
 *   expiryDate: string | null,
 *   serialNumber: string | null,
 *   productionDate: string | null,
 *   bestBefore: string | null,
 *   nhrn: { ai: string, value: string } | null,
 *   extras: Record<string, string>,
 *   unparsed: string,
 * }}
 *   `null` when the input yields nothing usable, so the caller can report an
 *   unrecognised code rather than silently filling an empty form. A GTIN that
 *   fails its check digit also returns `null`: a misread product code means the
 *   lot and expiry from the same symbol cannot be trusted either.
 */
export function parseGs1(raw, today = new Date()) {
  if (typeof raw !== 'string') return null
  const input = normalise(raw)
  if (input === '') return null

  let result
  if (/^https?:\/\//i.test(input)) result = parseDigitalLink(input)
  else if (/^\(\d{2,4}\)/.test(input)) result = parseHumanReadable(input)
  else result = parseElementString(input)

  const { pairs, unparsed } = result
  if (pairs.length === 0) return null

  const values = {}
  for (const [ai, value] of pairs) {
    if (!(ai in values)) values[ai] = value
  }

  const gtin = values['01'] ?? null
  if (gtin !== null && !isValidGtin(gtin)) return null

  const nhrnAi = NHRN_AIS.find((ai) => ai in values) ?? null
  const named = new Set(['01', '10', '11', '15', '17', '21', ...(nhrnAi ? [nhrnAi] : [])])
  const extras = {}
  for (const [ai, value] of Object.entries(values)) {
    if (!named.has(ai)) extras[ai] = value
  }

  return {
    gtin,
    lotNumber: values['10'] || null,
    expiryDate: values['17'] ? parseGs1Date(values['17'], today) : null,
    serialNumber: values['21'] || null,
    productionDate: values['11'] ? parseGs1Date(values['11'], today) : null,
    bestBefore: values['15'] ? parseGs1Date(values['15'], today) : null,
    nhrn: nhrnAi ? { ai: nhrnAi, value: values[nhrnAi] } : null,
    extras,
    unparsed,
  }
}
