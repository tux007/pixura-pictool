import { describe, expect, it } from 'vitest'
import { isSmallScreen, MIN_SCREEN_SIDE } from './dom'

describe('isSmallScreen', () => {
  it('flags phones in both orientations', () => {
    expect(isSmallScreen(390, 844)).toBe(true) // iPhone, portrait
    expect(isSmallScreen(844, 390)).toBe(true) // iPhone, landscape
    expect(isSmallScreen(360, 800)).toBe(true) // typical Android phone
    expect(isSmallScreen(430, 932)).toBe(true) // large phone
  })

  it('flags the iPad mini and other 8 inch tablets', () => {
    expect(isSmallScreen(744, 1133)).toBe(true)
    expect(isSmallScreen(1133, 744)).toBe(true)
    expect(isSmallScreen(600, 960)).toBe(true)
  })

  it('accepts the larger iPads', () => {
    expect(isSmallScreen(810, 1080)).toBe(false) // iPad 10.2
    expect(isSmallScreen(820, 1180)).toBe(false) // iPad Air / 10th gen
    expect(isSmallScreen(834, 1194)).toBe(false) // iPad Pro 11
    expect(isSmallScreen(1024, 1366)).toBe(false) // iPad Pro 12.9
  })

  it('accepts laptops and desktops', () => {
    expect(isSmallScreen(1366, 768)).toBe(false)
    expect(isSmallScreen(1440, 900)).toBe(false)
    expect(isSmallScreen(1920, 1080)).toBe(false)
  })

  it('draws the line at the shorter side', () => {
    expect(isSmallScreen(MIN_SCREEN_SIDE - 1, 2000)).toBe(true)
    expect(isSmallScreen(MIN_SCREEN_SIDE, 2000)).toBe(false)
  })
})
