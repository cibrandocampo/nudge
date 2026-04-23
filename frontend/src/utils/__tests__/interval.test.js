import { describe, expect, it } from 'vitest'
import { UNIT_FACTORS, UNIT_KEYS, UNIT_MAX_VALUES, clampValue, hoursToHuman, toHours } from '../interval'

describe('interval util — constants', () => {
  it('exposes 5 units ordered from smallest to largest', () => {
    expect(UNIT_KEYS).toEqual(['hours', 'days', 'weeks', 'months', 'years'])
  })

  it('has the expected factors and maxima per unit', () => {
    expect(UNIT_FACTORS).toEqual({ hours: 1, days: 24, weeks: 168, months: 720, years: 8760 })
    expect(UNIT_MAX_VALUES).toEqual({ hours: 17520, days: 730, weeks: 104, months: 24, years: 2 })
  })
})

describe('interval util — toHours', () => {
  it('multiplies value by the unit factor', () => {
    expect(toHours(3, 'days')).toBe(72)
    expect(toHours(2, 'years')).toBe(17520)
    expect(toHours(1, 'hours')).toBe(1)
  })

  it('returns 0 for an unknown unit', () => {
    expect(toHours(5, 'eons')).toBe(0)
  })
})

describe('interval util — hoursToHuman', () => {
  it('picks the largest unit that divides exactly', () => {
    expect(hoursToHuman(24)).toEqual({ value: 1, unit: 'days' })
    expect(hoursToHuman(168)).toEqual({ value: 1, unit: 'weeks' })
    expect(hoursToHuman(72)).toEqual({ value: 3, unit: 'days' })
    expect(hoursToHuman(720)).toEqual({ value: 1, unit: 'months' })
    expect(hoursToHuman(8760)).toEqual({ value: 1, unit: 'years' })
  })

  it('falls back to hours when no larger unit divides exactly', () => {
    expect(hoursToHuman(5)).toEqual({ value: 5, unit: 'hours' })
    expect(hoursToHuman(25)).toEqual({ value: 25, unit: 'hours' })
  })

  it('keeps 0 as hours so the consumer can show a fresh draft', () => {
    expect(hoursToHuman(0)).toEqual({ value: 0, unit: 'hours' })
  })
})

describe('interval util — clampValue', () => {
  it('clamps below the minimum to 1', () => {
    expect(clampValue(0, 'days')).toBe(1)
    expect(clampValue(-5, 'months')).toBe(1)
  })

  it('clamps above the per-unit maximum', () => {
    expect(clampValue(200, 'weeks')).toBe(104)
    expect(clampValue(99999, 'years')).toBe(2)
  })

  it('normalises empty / NaN inputs to 1', () => {
    expect(clampValue('', 'hours')).toBe(1)
    expect(clampValue('abc', 'hours')).toBe(1)
  })

  it('floors fractional values', () => {
    expect(clampValue(3.7, 'days')).toBe(3)
  })

  it('preserves in-range integers', () => {
    expect(clampValue(12, 'hours')).toBe(12)
    expect(clampValue(24, 'months')).toBe(24)
  })

  it('falls back to the hours cap when the unit is unknown', () => {
    // Unknown unit → uses UNIT_MAX_VALUES.hours (17520) as the cap.
    expect(clampValue(99999, 'decades')).toBe(17520)
  })
})
