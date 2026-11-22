import { describe, expect, it } from 'vitest'
import {
  checkRules,
  DEFAULT_RULES,
  describeCheck,
  fitToArea,
  limitValue,
  maxScaleAtCenter,
  minDistance,
  printLimits,
  reserves,
  scaleBox,
  type RuleSettings,
} from './clearance'
import { boxBounds } from './guides'
import type { Box } from './motif'

// A wall 600 cm wide and 300 cm high, origin at its top-left corner.
const wall = { ceiling: 0, floor: 300, left: 0, right: 600 }
const rules = (over: Partial<RuleSettings> = {}): RuleSettings => ({ ...DEFAULT_RULES, ...over })
const box = (over: Partial<Box> = {}): Box => ({ x: 300, y: 150, w: 200, h: 100, rot: 0, ...over })

describe('minimum distances (wallPen)', () => {
  it('follows the data sheet', () => {
    expect(minDistance('ceiling', rules())).toBe(40)
    expect(minDistance('left', rules())).toBe(10)
    expect(minDistance('right', rules())).toBe(10)
    expect(minDistance('floor', rules())).toBe(25)
  })

  it('uses 30 cm to the floor with the rail', () => {
    expect(minDistance('floor', rules({ rail: true }))).toBe(30)
  })

  it('measures the floor distance from the top of the skirting board', () => {
    expect(minDistance('floor', rules({ skirtingCm: 8 }))).toBe(33)
    expect(minDistance('floor', rules({ skirtingCm: 8, rail: true }))).toBe(38)
    expect(minDistance('floor', rules({ skirtingCm: -5 }))).toBe(25)
  })
})

describe('printLimits', () => {
  it('turns guide lines into the edges of the printable area', () => {
    expect(printLimits(wall, rules())).toEqual({ top: 40, bottom: 275, left: 10, right: 590 })
  })

  it('only reports sides whose guide is set', () => {
    expect(printLimits({ ceiling: 5 }, rules())).toEqual({ top: 45 })
    expect(printLimits({}, rules())).toEqual({})
  })

  it('moves the limit line in the right direction for each kind', () => {
    expect(limitValue('ceiling', 100, rules())).toBe(140)
    expect(limitValue('floor', 400, rules())).toBe(375)
    expect(limitValue('left', 20, rules())).toBe(30)
    expect(limitValue('right', 500, rules())).toBe(490)
  })
})

describe('reserves and checkRules', () => {
  it('measures the room between the motif and each limit', () => {
    const r = reserves(box(), printLimits(wall, rules()))
    const by = Object.fromEntries(r.map((x) => [x.side, x.cm]))
    // motif spans x 200..400, y 100..200
    expect(by).toEqual({ top: 60, bottom: 75, left: 190, right: 190 })
  })

  it('accepts a motif inside the area', () => {
    const c = checkRules(box(), wall, rules())
    expect(c.state).toBe('ok')
    expect(c.violated).toEqual([])
    expect(c.missing).toEqual([])
  })

  it('flags each side that is too close', () => {
    const c = checkRules(box({ y: 120 }), wall, rules()) // top edge at 70... still fine
    expect(c.state).toBe('ok')
    const tight = checkRules(box({ x: 100, y: 80 }), wall, rules()) // x 0..200, y 30..130
    expect(tight.state).toBe('violated')
    expect(tight.violated.map((v) => v.side).sort()).toEqual(['left', 'top'])
    expect(tight.violated.find((v) => v.side === 'top')?.cm).toBeCloseTo(-10)
    expect(tight.violated.find((v) => v.side === 'left')?.cm).toBeCloseTo(-10)
  })

  it('treats exactly the minimum distance as fine', () => {
    const c = checkRules(box({ y: 90, h: 100, x: 300 }), wall, rules()) // top at 40
    expect(c.state).toBe('ok')
  })

  it('uses the rotated bounding box', () => {
    // 200 x 100 turned by 90 degrees occupies 100 wide, 200 high: y 50..250 -> bottom reserve 25
    const ok = checkRules(box({ rot: 90 }), wall, rules())
    expect(ok.state).toBe('ok')
    const low = checkRules(box({ rot: 90, y: 160 }), wall, rules()) // bottom at 260 > 275? no, 260 < 275
    expect(low.state).toBe('ok')
    const tooLow = checkRules(box({ rot: 90, y: 180 }), wall, rules()) // bottom at 280 > 275
    expect(tooLow.state).toBe('violated')
    expect(tooLow.violated[0]?.side).toBe('bottom')
  })

  it('reports unchecked sides and states', () => {
    expect(checkRules(box(), {}, rules()).state).toBe('unchecked')
    const partial = checkRules(box(), { ceiling: 0, floor: 300 }, rules())
    expect(partial.state).toBe('ok')
    expect(partial.missing.sort()).toEqual(['left', 'right'])
    expect(checkRules(box(), wall, rules({ enabled: false })).state).toBe('off')
  })

  it('counts the skirting board and the rail against the floor distance', () => {
    const b = box({ y: 215 }) // bottom edge at 265, 35 cm above the floor
    expect(checkRules(b, wall, rules()).state).toBe('ok')
    expect(checkRules(b, wall, rules({ rail: true })).state).toBe('ok')
    expect(checkRules(b, wall, rules({ skirtingCm: 10 })).state).toBe('ok') // needs exactly 35, has 35
    expect(checkRules(b, wall, rules({ skirtingCm: 12 })).state).toBe('violated') // needs 37
    expect(checkRules(b, wall, rules({ skirtingCm: 10, rail: true })).state).toBe('violated') // needs 40
  })
})

describe('maxScaleAtCenter', () => {
  it('grows the motif around its centre until the nearest limit', () => {
    // centre (300,150); limits top 40, bottom 275, left 10, right 590; half size 100 x 50
    // caps: left 290/100, right 290/100, top 110/50 = 2.2, bottom 125/50 = 2.5
    expect(maxScaleAtCenter(box(), printLimits(wall, rules()))).toBeCloseTo(2.2)
  })

  it('shrinks to zero when the centre is outside the area', () => {
    expect(maxScaleAtCenter(box({ y: 20 }), printLimits(wall, rules()))).toBe(0)
  })

  it('considers rotation', () => {
    // rotated by 90 degrees the half extents swap: ex 50, ey 100 -> top cap 110/100 = 1.1
    expect(maxScaleAtCenter(box({ rot: 90 }), printLimits(wall, rules()))).toBeCloseTo(1.1)
  })

  it('works with a single limit and returns null without any', () => {
    expect(maxScaleAtCenter(box(), { top: 100 })).toBeCloseTo(1) // 50 / 50
    expect(maxScaleAtCenter(box(), {})).toBeNull()
  })

  it('a motif scaled by that factor just touches the limit', () => {
    const limits = printLimits(wall, rules())
    const k = maxScaleAtCenter(box(), limits) ?? 0
    const grown = scaleBox(box(), k)
    const reserve = reserves(grown, limits)
    expect(Math.min(...reserve.map((x) => x.cm))).toBeCloseTo(0, 6)
    expect(checkRules(grown, wall, rules()).state).toBe('ok')
  })
})

describe('fitToArea', () => {
  it('fills the printable area by width when the motif is wide', () => {
    // area 580 x 235 (x 10..590, y 40..275); motif 2:1 -> limited by height: 235 high, 470 wide
    const fit = fitToArea(box(), printLimits(wall, rules()))
    expect(fit).not.toBeNull()
    expect(fit?.h).toBeCloseTo(235)
    expect(fit?.w).toBeCloseTo(470)
    expect(fit?.x).toBeCloseTo(300)
    expect(fit?.y).toBeCloseTo(157.5)
  })

  it('fills by width when the motif is tall', () => {
    const fit = fitToArea(box({ w: 100, h: 400 }), printLimits(wall, rules()))
    expect(fit?.h).toBeCloseTo(235)
    expect(fit?.w).toBeCloseTo(58.75)
  })

  it('keeps shape and rotation, and satisfies the rules', () => {
    const fit = fitToArea(box({ rot: 30 }), printLimits(wall, rules()))
    expect(fit?.rot).toBe(30)
    expect((fit?.w ?? 0) / (fit?.h ?? 1)).toBeCloseTo(2)
    expect(fit && checkRules(fit, wall, rules()).state).toBe('ok')
    const b = fit && boxBounds(fit)
    // touches at least one limit
    const r = fit ? reserves(fit, printLimits(wall, rules())) : []
    expect(Math.min(...r.map((x) => x.cm))).toBeCloseTo(0, 6)
    expect(b).toBeTruthy()
  })

  it('returns null if a side is missing or the area is empty', () => {
    expect(fitToArea(box(), printLimits({ ceiling: 0, floor: 300, left: 0 }, rules()))).toBeNull()
    expect(fitToArea(box(), printLimits({ ceiling: 0, floor: 50, left: 0, right: 600 }, rules()))).toBeNull()
    expect(fitToArea(box(), printLimits({ ceiling: 0, floor: 300, left: 0, right: 15 }, rules()))).toBeNull()
  })

  it('respects the skirting board and rail', () => {
    const fit = fitToArea(box(), printLimits(wall, rules({ skirtingCm: 10, rail: true })))
    // floor limit 300 - 40 = 260 -> area height 220
    expect(fit?.h).toBeCloseTo(220)
  })
})

describe('describeCheck', () => {
  it('says nothing when the check is off', () => {
    expect(describeCheck(checkRules(box(), wall, rules({ enabled: false })), rules({ enabled: false }))).toBe('')
  })

  it('asks for guide lines when none are set', () => {
    expect(describeCheck(checkRules(box(), {}, rules()), rules())).toContain('Hilfslinien setzen')
  })

  it('lists violations with the missing distance', () => {
    const text = describeCheck(checkRules(box({ x: 100, y: 80 }), wall, rules()), rules())
    expect(text).toContain('unterschritten')
    expect(text).toContain('Decke (-10 cm)')
    expect(text).toContain('Linke Innenecke (-10 cm)')
  })

  it('confirms the rules and names unchecked sides', () => {
    const ok = describeCheck(checkRules(box(), wall, rules()), rules())
    expect(ok).toContain('eingehalten')
    expect(ok).toContain('Boden 25 cm')
    const partial = describeCheck(checkRules(box(), { ceiling: 0 }, rules()), rules())
    expect(partial).toContain('Nicht geprüft: Boden, Linke Innenecke, Rechte Innenecke')
    expect(describeCheck(checkRules(box(), wall, rules({ rail: true })), rules({ rail: true }))).toContain('Boden 30 cm')
  })
})
