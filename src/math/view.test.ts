import { describe, expect, it } from 'vitest'
import {
  fitScale,
  fitView,
  keepVisible,
  panBy,
  pinchView,
  toImage,
  toScreen,
  zoomAt,
  zoomLimits,
} from './view'

const vp = { w: 800, h: 600 }
const lim = { min: 0.1, max: 8 }

describe('fit', () => {
  it('fits landscape by width and centres vertically', () => {
    const v = fitView({ w: 2000, h: 1000 }, vp)
    expect(v.scale).toBeCloseTo(0.4)
    expect(v.tx).toBeCloseTo(0)
    expect(v.ty).toBeCloseTo(100)
  })

  it('fits portrait by height and centres horizontally', () => {
    const v = fitView({ w: 1000, h: 3000 }, vp)
    expect(v.scale).toBeCloseTo(0.2)
    expect(v.tx).toBeCloseTo(300)
    expect(v.ty).toBeCloseTo(0)
  })

  it('falls back to 1 for degenerate sizes', () => {
    expect(fitScale({ w: 0, h: 0 }, vp)).toBe(1)
    expect(fitScale({ w: 100, h: 100 }, { w: 0, h: 0 })).toBe(1)
    expect(fitScale({ w: 100, h: 100 }, { w: 100, h: 100 }, 60)).toBe(1)
  })
})

describe('coordinates', () => {
  it('round-trips screen and image points', () => {
    const v = { scale: 0.37, tx: 41, ty: -13 }
    const p = { x: 512, y: 128 }
    const back = toImage(v, toScreen(v, p))
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })
})

describe('zoomAt', () => {
  it('keeps the focus point fixed', () => {
    const v = { scale: 0.5, tx: 30, ty: 50 }
    const focus = { x: 400, y: 300 }
    const before = toImage(v, focus)
    const z = zoomAt(v, focus, 2.5, lim)
    const after = toImage(z, focus)
    expect(z.scale).toBeCloseTo(1.25)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it('clamps to the limits without moving the focus point', () => {
    const v = { scale: 7, tx: 0, ty: 0 }
    const focus = { x: 100, y: 100 }
    const before = toImage(v, focus)
    const z = zoomAt(v, focus, 10, lim)
    expect(z.scale).toBe(8)
    const after = toImage(z, focus)
    expect(after.x).toBeCloseTo(before.x)
  })
})

describe('zoomLimits', () => {
  it('allows zooming out to a quarter of fit and in to at least 8x', () => {
    const l = zoomLimits({ w: 2000, h: 1000 }, vp)
    expect(l.min).toBeCloseTo(0.1)
    expect(l.max).toBe(8)
  })

  it('raises max for tiny images that fit above 8x', () => {
    const l = zoomLimits({ w: 10, h: 10 }, vp)
    expect(l.max).toBeCloseTo(60)
  })
})

describe('pinchView', () => {
  it('scales by the finger distance ratio around the midpoint', () => {
    const start = { scale: 1, tx: 0, ty: 0 }
    const v = pinchView(
      start,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 50, y: 100 },
      { x: 250, y: 100 },
      lim,
    )
    expect(v.scale).toBeCloseTo(2)
    const anchor = toScreen(v, { x: 150, y: 100 })
    expect(anchor.x).toBeCloseTo(150)
    expect(anchor.y).toBeCloseTo(100)
  })

  it('pans when both fingers translate', () => {
    const start = { scale: 1, tx: 10, ty: 10 }
    const v = pinchView(
      start,
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 130, y: 120 },
      { x: 230, y: 120 },
      lim,
    )
    expect(v.scale).toBeCloseTo(1)
    expect(v.tx).toBeCloseTo(40)
    expect(v.ty).toBeCloseTo(30)
  })

  it('ignores zero start distance', () => {
    const p = { x: 10, y: 10 }
    const v = pinchView({ scale: 2, tx: 0, ty: 0 }, p, p, { x: 0, y: 0 }, { x: 50, y: 0 }, lim)
    expect(v.scale).toBe(2)
  })
})

describe('keepVisible', () => {
  const img = { w: 1000, h: 1000 }

  it('leaves a visible view alone', () => {
    const v = { scale: 0.5, tx: 100, ty: 50 }
    expect(keepVisible(v, img, vp)).toEqual(v)
  })

  it('pulls the image back when panned far off-screen', () => {
    const left = keepVisible({ scale: 1, tx: -5000, ty: 0 }, img, vp)
    expect(left.tx).toBe(80 - 1000)
    const right = keepVisible({ scale: 1, tx: 5000, ty: 0 }, img, vp)
    expect(right.tx).toBe(800 - 80)
    const below = keepVisible({ scale: 1, tx: 0, ty: 5000 }, img, vp)
    expect(below.ty).toBe(600 - 80)
  })

  it('still works when the image is smaller than the margin', () => {
    const v = keepVisible({ scale: 0.01, tx: 9999, ty: 9999 }, img, vp)
    expect(v.tx).toBeLessThanOrEqual(vp.w)
    expect(v.tx + 10).toBeGreaterThan(0)
  })
})

describe('panBy', () => {
  it('translates without touching scale', () => {
    expect(panBy({ scale: 2, tx: 1, ty: 2 }, 3, -4)).toEqual({ scale: 2, tx: 4, ty: -2 })
  })
})
