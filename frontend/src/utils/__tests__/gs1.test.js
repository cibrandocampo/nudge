import { describe, it, expect } from 'vitest'
import { parseGs1, parseGs1Date, isValidGtin } from '../gs1'

// FNC1 as it surfaces in decoded text.
const GS = '\u001d'
// Canonical GS1 example GTIN — its mod-10 check digit is valid.
const GTIN = '09506000134376'
// Fixed "today" so the century window is deterministic regardless of when the
// suite runs.
const TODAY = new Date('2026-08-06T12:00:00Z')

const parse = (raw) => parseGs1(raw, TODAY)

describe('parseGs1 — standard pharma payload', () => {
  it('extracts gtin, expiry, lot and serial from a GS-separated payload', () => {
    const result = parse(`01${GTIN}17280430102G3F41A${GS}21987654321098`)
    expect(result).toMatchObject({
      gtin: GTIN,
      expiryDate: '2028-04-30',
      lotNumber: '2G3F41A',
      serialNumber: '987654321098',
    })
  })

  it('reads the same fields when the serial comes before the lot', () => {
    const result = parse(`01${GTIN}1728043021123456${GS}102G3F41A`)
    expect(result).toMatchObject({
      gtin: GTIN,
      expiryDate: '2028-04-30',
      serialNumber: '123456',
      lotNumber: '2G3F41A',
    })
  })

  it('parses a payload with no GTIN', () => {
    const result = parse(`17280430102G3F41A`)
    expect(result).toMatchObject({ gtin: null, expiryDate: '2028-04-30', lotNumber: '2G3F41A' })
  })
})

describe('parseGs1 — date rules', () => {
  it('resolves day 00 to the last day of the month in a leap year', () => {
    expect(parse(`01${GTIN}17280200`).expiryDate).toBe('2028-02-29')
  })

  it('resolves day 00 to the last day of a non-leap February', () => {
    expect(parse(`01${GTIN}17270200`).expiryDate).toBe('2027-02-28')
  })

  it('places a far two-digit year in the past century', () => {
    expect(parse(`01${GTIN}17990101`).expiryDate).toBe('1999-01-01')
  })

  it('places a far two-digit year in the next century', () => {
    // Late in a century the window pushes forward instead of back: from 2080,
    // "29" is 2129, not 2029.
    expect(parseGs1Date('290101', new Date('2080-06-01T12:00:00Z'))).toBe('2129-01-01')
  })

  it('rejects an impossible month or day', () => {
    expect(parseGs1Date('281301', TODAY)).toBeNull()
    expect(parseGs1Date('280231', TODAY)).toBeNull()
  })

  it('rejects a malformed date string', () => {
    expect(parseGs1Date('28043', TODAY)).toBeNull()
    expect(parseGs1Date('2804XX', TODAY)).toBeNull()
  })

  it('reads production date and best-before when present', () => {
    const result = parse(`01${GTIN}1126010115281231`)
    expect(result.productionDate).toBe('2026-01-01')
    expect(result.bestBefore).toBe('2028-12-31')
  })
})

describe('parseGs1 — input forms', () => {
  const plain = `01${GTIN}17280430102G3F41A${GS}2112345`

  it('ignores a symbology identifier prefix', () => {
    expect(parse(`]d2${plain}`)).toEqual(parse(plain))
  })

  it('ignores a leading FNC1 character', () => {
    expect(parse(`${GS}${plain}`)).toEqual(parse(plain))
  })

  it('parses the human-readable parenthesised form', () => {
    const result = parse(`(01)${GTIN}(17)280430(10)2G3F41A(21)12345`)
    expect(result).toMatchObject({
      gtin: GTIN,
      expiryDate: '2028-04-30',
      lotNumber: '2G3F41A',
      serialNumber: '12345',
    })
  })

  it('parses a GS1 Digital Link URI', () => {
    const result = parse(`https://id.gs1.org/01/${GTIN}/10/2G3F41A?17=280430&21=12345`)
    expect(result).toMatchObject({
      gtin: GTIN,
      expiryDate: '2028-04-30',
      lotNumber: '2G3F41A',
      serialNumber: '12345',
    })
  })

  it('ignores a path prefix before the first AI segment in a Digital Link', () => {
    const result = parse(`https://example.com/shop/01/${GTIN}/10/LOT-9`)
    expect(result).toMatchObject({ gtin: GTIN, lotNumber: 'LOT-9' })
  })

  it('returns null for a malformed URI', () => {
    expect(parse('https://')).toBeNull()
  })

  it('returns null for a URL with no AI segment', () => {
    expect(parse('https://example.com/about/us')).toBeNull()
  })

  it('stops at the first non-AI path segment', () => {
    const result = parse(`https://id.gs1.org/01/${GTIN}/promo/summer`)
    expect(result.gtin).toBe(GTIN)
    expect(result.lotNumber).toBeNull()
  })

  it('ignores non-AI query parameters', () => {
    const result = parse(`https://id.gs1.org/01/${GTIN}?17=280430&utm_source=mail`)
    expect(result).toMatchObject({ gtin: GTIN, expiryDate: '2028-04-30' })
    expect(result.extras).toEqual({})
  })
})

describe('parseGs1 — refusing to guess', () => {
  it('returns null when the GTIN check digit is wrong', () => {
    expect(parse(`01095060001343771728043010LOT`)).toBeNull()
  })

  it('lets a variable field run to the end when the GS is missing', () => {
    // A malformed code with no separator: AI 10 legitimately swallows the rest.
    // Documented limitation, not something to heuristically "fix".
    const result = parse(`01${GTIN}17280430102G3F41A21123456`)
    expect(result.lotNumber).toBe('2G3F41A21123456')
    expect(result.serialNumber).toBeNull()
  })

  it('stops at an unknown AI and keeps the remainder', () => {
    const result = parse(`01${GTIN}1728043099XYZ`)
    expect(result).toMatchObject({ gtin: GTIN, expiryDate: '2028-04-30' })
    expect(result.unparsed).toBe('99XYZ')
  })

  it('stops when a fixed-length field is truncated', () => {
    const result = parse(`01${GTIN}172804`)
    expect(result.gtin).toBe(GTIN)
    expect(result.expiryDate).toBeNull()
    expect(result.unparsed).toBe('172804')
  })

  it('returns null for empty or non-barcode input', () => {
    expect(parse('')).toBeNull()
    expect(parse('   ')).toBeNull()
    expect(parse('not a barcode')).toBeNull()
    expect(parseGs1(null)).toBeNull()
    expect(parseGs1(undefined)).toBeNull()
    expect(parseGs1(42)).toBeNull()
  })
})

describe('parseGs1 — secondary identifiers', () => {
  it('reads the Spanish national code from AI 712', () => {
    const result = parse(`01${GTIN}17280430712123456${GS}102G3F41A`)
    expect(result.nhrn).toEqual({ ai: '712', value: '123456' })
    expect(result.lotNumber).toBe('2G3F41A')
  })

  it('reads other NHRN identifiers', () => {
    expect(parse(`01${GTIN}710987654`).nhrn).toEqual({ ai: '710', value: '987654' })
  })

  it('collects recognised but unmapped AIs in extras', () => {
    const result = parse(`01${GTIN}${GS}3012${GS}102G3F41A`)
    expect(result.extras).toEqual({ 30: '12' })
    expect(result.lotNumber).toBe('2G3F41A')
  })

  it('keeps the first value when an AI repeats', () => {
    const result = parse(`10FIRST${GS}10SECOND`)
    expect(result.lotNumber).toBe('FIRST')
  })
})

describe('isValidGtin', () => {
  it('accepts a correct check digit', () => {
    expect(isValidGtin(GTIN)).toBe(true)
  })

  it('rejects a wrong check digit', () => {
    expect(isValidGtin('09506000134377')).toBe(false)
  })

  it('rejects anything that is not 14 digits', () => {
    expect(isValidGtin('123')).toBe(false)
    expect(isValidGtin('0950600013437X')).toBe(false)
  })
})
