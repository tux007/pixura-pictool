import { describe, expect, it } from 'vitest'
import {
  angleFromPointer,
  contains,
  cornerPoint,
  moveBy,
  normalizeAngle,
  resizeFromCorner,
  setHeight,
  setWidth,
  type Box,
  type Corner,
} from './motif'

const box = (over: Partial<Box> = {}): Box => ({ x: 200, y: 150, w: 100, h: 50, rot: 0, ...over })

describe('setWidth / setHeight', () => {
  it('derives the other side when the aspect is locked', () => {
    const b = setWidth(box(), 300, 2, true)
    expect(b.w).toBe(300)
    expect(b.h).toBe(150)
    const c = setHeight(box(), 40, 2, true)
    expect(c.h).toBe(40)
    expect(c.w).toBe(80)
  })

  it('leaves the other side alone when unlocked', () => {
    const b = setWidth(box(), 300, 2, false)
    expect(b.h).toBe(50)
  })

  it('clamps to sane limits', () => {
    expect(setWidth(box(), 0, 2, false).w).toBe(1)
    expect(setWidth(box(), 1e9, 2, false).w).toBe(10000)
  })

  it('keeps the centre', () => {
    const b = setWidth(box(), 300, 2, true)
    expect([b.x, b.y]).toEqual([200, 150])
  })
})

describe('resizeFromCorner', () => {
  const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' }

  for (const rot of [0, 90, 30, -135]) {
    for (const corner of ['nw', 'ne', 'se', 'sw'] as Corner[]) {
      for (const lock of [true, false]) {
        it(`keeps the opposite corner fixed (rot ${rot}, ${corner}, lock ${lock})`, () => {
          const b = box({ rot })
          const target = cornerPoint(b, corner)
          const before = cornerPoint(b, opposite[corner])
          const r = resizeFromCorner(b, corner, { x: target.x + 17, y: target.y - 9 }, lock)
          const after = cornerPoint(r, opposite[corner])
          expect(after.x).toBeCloseTo(before.x, 6)
          expect(after.y).toBeCloseTo(before.y, 6)
        })
      }
    }
  }

  it('scales uniformly when locked', () => {
    const r = resizeFromCorner(box(), 'se', { x: 350, y: 175 + 50 }, true)
    expect(r.w / r.h).toBeCloseTo(2)
    expect(r.w).toBeGreaterThan(100)
  })

  it('doubles the size when the corner moves twice as far (locked)', () => {
    // box spans x 150..250, y 125..175; drag se from (250,175) to (350,225)
    const r = resizeFromCorner(box(), 'se', { x: 350, y: 225 }, true)
    expect(r.w).toBeCloseTo(200)
    expect(r.h).toBeCloseTo(100)
    expect(r.x).toBeCloseTo(250)
    expect(r.y).toBeCloseTo(175)
  })

  it('changes width and height independently when unlocked', () => {
    const r = resizeFromCorner(box(), 'se', { x: 350, y: 175 }, false)
    expect(r.w).toBeCloseTo(200)
    expect(r.h).toBeCloseTo(50)
  })

  it('never inverts or collapses', () => {
    const r = resizeFromCorner(box(), 'se', { x: 0, y: 0 }, false)
    expect(r.w).toBe(1)
    expect(r.h).toBe(1)
    const l = resizeFromCorner(box(), 'se', { x: 0, y: 0 }, true)
    expect(l.w).toBeGreaterThanOrEqual(1)
    expect(l.h).toBeGreaterThanOrEqual(1)
    expect(l.w / l.h).toBeCloseTo(2)
  })
})

describe('angleFromPointer', () => {
  it('is 0 straight above, 90 to the right', () => {
    expect(angleFromPointer(box(), { x: 200, y: 50 })).toBe(0)
    expect(angleFromPointer(box(), { x: 300, y: 150 })).toBe(90)
    expect(angleFromPointer(box(), { x: 100, y: 150 })).toBe(-90)
    expect(angleFromPointer(box(), { x: 200, y: 250 })).toBe(180)
  })

  it('snaps near multiples of 15 only', () => {
    const near = angleFromPointer(box(), { x: 200 + Math.sin(0.04) * 100, y: 150 - Math.cos(0.04) * 100 })
    expect(near).toBe(0)
    const far = angleFromPointer(box(), { x: 200 + Math.sin(0.13) * 100, y: 150 - Math.cos(0.13) * 100 })
    expect(far).toBeCloseTo((0.13 * 180) / Math.PI, 5)
  })

  it('keeps the current angle if the pointer is on the centre', () => {
    expect(angleFromPointer(box({ rot: 42 }), { x: 200, y: 150 })).toBe(42)
  })
})

describe('geometry', () => {
  it('normalises angles into (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170)
    expect(normalizeAngle(-190)).toBe(170)
    expect(normalizeAngle(180)).toBe(180)
    expect(normalizeAngle(-180)).toBe(180)
    expect(normalizeAngle(720)).toBe(0)
  })

  it('computes rotated corners', () => {
    const c = cornerPoint(box({ rot: 90 }), 'ne')
    // local (50,-25) rotated by 90deg clockwise -> (25, 50)
    expect(c.x).toBeCloseTo(225)
    expect(c.y).toBeCloseTo(200)
  })

  it('hit-tests rotated boxes', () => {
    const b = box({ rot: 90 })
    expect(contains(b, { x: 200, y: 190 })).toBe(true)
    expect(contains(b, { x: 240, y: 150 })).toBe(false)
  })

  it('moves by a delta', () => {
    expect(moveBy(box(), 5, -5)).toMatchObject({ x: 205, y: 145 })
  })
})
