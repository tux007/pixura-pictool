import { describe, expect, it } from 'vitest'
import { calibrateLinear, imageToWall, wallToImage } from './calibration'

describe('calibrateLinear', () => {
  it('derives pixels per cm from a horizontal reference', () => {
    const r = calibrateLinear({ x: 100, y: 100 }, { x: 600, y: 100 }, 250)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.calibration.pxPerCm).toBeCloseTo(2)
      expect(r.warnings).toEqual([])
    }
  })

  it('works for diagonal references', () => {
    const r = calibrateLinear({ x: 0, y: 0 }, { x: 300, y: 400 }, 100)
    expect(r.ok && r.calibration.pxPerCm).toBeCloseTo(5)
  })

  it('rejects identical or sub-pixel points', () => {
    expect(calibrateLinear({ x: 5, y: 5 }, { x: 5, y: 5 }, 100)).toEqual({ ok: false, error: 'points-too-close' })
    expect(calibrateLinear({ x: 5, y: 5 }, { x: 5.2, y: 5 }, 100)).toEqual({ ok: false, error: 'points-too-close' })
  })

  it('rejects zero, negative and non-finite distances', () => {
    for (const d of [0, -10, NaN, Infinity]) {
      expect(calibrateLinear({ x: 0, y: 0 }, { x: 100, y: 0 }, d)).toEqual({ ok: false, error: 'bad-distance' })
    }
  })

  it('warns about short references and nearby points', () => {
    const short = calibrateLinear({ x: 0, y: 0 }, { x: 400, y: 0 }, 60)
    expect(short.ok && short.warnings).toEqual(['short-reference'])
    const close = calibrateLinear({ x: 0, y: 0 }, { x: 20, y: 0 }, 200)
    expect(close.ok && close.warnings).toEqual(['close-points'])
    const both = calibrateLinear({ x: 0, y: 0 }, { x: 10, y: 0 }, 10)
    expect(both.ok && both.warnings).toEqual(['short-reference', 'close-points'])
  })

  it('still computes a scale for a very small reference', () => {
    const r = calibrateLinear({ x: 0, y: 0 }, { x: 100, y: 0 }, 1)
    expect(r.ok && r.calibration.pxPerCm).toBeCloseTo(100)
  })
})

describe('wall <-> image', () => {
  const cal = { mode: 'linear', pxPerCm: 5 } as const

  it('a 100 cm motif spans 500 px at 5 px/cm', () => {
    const a = wallToImage(cal, { x: 0, y: 0 })
    const b = wallToImage(cal, { x: 100, y: 0 })
    expect(b.x - a.x).toBeCloseTo(500)
  })

  it('round-trips', () => {
    const p = { x: 123.4, y: 56.7 }
    const back = imageToWall(cal, wallToImage(cal, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })
})
