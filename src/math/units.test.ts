import { describe, expect, it } from 'vitest'
import { formatLength, formatNumber, parseLength } from './units'

describe('parseLength', () => {
  it('reads centimetres by default', () => {
    expect(parseLength('250')).toBe(250)
    expect(parseLength(' 80 cm ')).toBe(80)
  })

  it('accepts decimal comma and point', () => {
    expect(parseLength('2,5 m')).toBe(250)
    expect(parseLength('2.5m')).toBe(250)
    expect(parseLength('12,5')).toBe(12.5)
  })

  it('lets an explicit unit override the fallback', () => {
    expect(parseLength('3 m', 'cm')).toBe(300)
    expect(parseLength('300 cm', 'm')).toBe(300)
    expect(parseLength('3', 'm')).toBe(300)
  })

  it('rejects garbage, negatives and empty input', () => {
    for (const bad of ['', 'abc', '-5', '1,2,3', '5 km', '1 m 2', ',']) {
      expect(parseLength(bad)).toBeNull()
    }
  })
})

describe('format', () => {
  it('uses a decimal comma', () => {
    expect(formatNumber(66.666)).toBe('66,7')
    expect(formatNumber(2, 2)).toBe('2,00')
  })

  it('never shows negative zero', () => {
    expect(formatNumber(-0.01)).toBe('0,0')
  })

  it('switches to metres from 100 cm', () => {
    expect(formatLength(99.94)).toBe('99,9 cm')
    expect(formatLength(250)).toBe('2,50 m')
  })
})
