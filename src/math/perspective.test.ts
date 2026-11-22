import { describe, expect, it } from 'vitest'
import { imageToWall, wallToImage } from './calibration'
import { apply3, mul3, type Mat3 } from './homography'
import { calibratePerspective } from './perspective'
import type { Pt } from './view'

const IMG = { w: 3000, h: 2000 }
const W = 400
const H = 250

// Pinhole camera looking at a wall plane: wall cm -> image px. f = 2600 px, principal point at centre.
function camera(yawDeg: number, pitchDeg: number): Mat3 {
  const a = (yawDeg * Math.PI) / 180
  const b = (pitchDeg * Math.PI) / 180
  const ry: Mat3 = [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)]
  const rx: Mat3 = [1, 0, 0, 0, Math.cos(b), -Math.sin(b), 0, Math.sin(b), Math.cos(b)]
  const r = mul3(rx, ry)
  const [r00, r01, , r10, r11, , r20, r21] = r
  // Wall centre (W/2, H/2) sits 700 cm in front of the camera.
  const t = [-(W / 2) * r00 - (H / 2) * r01, -(W / 2) * r10 - (H / 2) * r11, 700 - (W / 2) * r20 - (H / 2) * r21]
  const m: Mat3 = [r00, r01, t[0] ?? 0, r10, r11, t[1] ?? 0, r20, r21, t[2] ?? 0]
  const k: Mat3 = [2600, 0, IMG.w / 2, 0, 2600, IMG.h / 2, 0, 0, 1]
  return mul3(k, m)
}

const corners: Pt[] = [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: H },
  { x: 0, y: H },
]

function quadOf(h: Mat3, noise = 0): [Pt, Pt, Pt, Pt] {
  const sign = [
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, -1],
  ]
  const q = corners.map((c, i) => {
    const p = apply3(h, c)
    const n = sign[i] ?? [0, 0]
    return { x: p.x + noise * (n[0] ?? 0), y: p.y + noise * (n[1] ?? 0) }
  })
  return q as [Pt, Pt, Pt, Pt]
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

// Pairs of wall points, inside and outside the calibration rectangle.
const pairs: [Pt, Pt][] = [
  [
    { x: 50, y: 20 },
    { x: 350, y: 220 },
  ],
  [
    { x: 10, y: 240 },
    { x: 390, y: 15 },
  ],
  [
    { x: 100, y: 100 },
    { x: 300, y: 100 },
  ],
  [
    { x: 200, y: 10 },
    { x: 200, y: 240 },
  ],
  [
    { x: -100, y: -50 },
    { x: 500, y: 300 },
  ],
]

describe('calibratePerspective: synthetic perspective', () => {
  for (const [yaw, pitch] of [
    [0, 0],
    [20, 5],
    [-30, 10],
    [35, -12],
  ] as const) {
    for (const noise of [0, 0.5]) {
      it(`wall distances within 1% (yaw ${yaw}, pitch ${pitch}, noise ${noise}px)`, () => {
        const truth = camera(yaw, pitch)
        const r = calibratePerspective(quadOf(truth, noise), W, H, IMG)
        expect(r.ok).toBe(true)
        if (!r.ok) return
        for (const [a, b] of pairs) {
          const ia = apply3(truth, a)
          const ib = apply3(truth, b)
          const measured = dist(imageToWall(r.calibration, ia), imageToWall(r.calibration, ib))
          const real = dist(a, b)
          expect(Math.abs(measured - real) / real).toBeLessThan(0.01)
        }
      })
    }
  }

  it('wall -> image -> wall round-trips', () => {
    const r = calibratePerspective(quadOf(camera(20, 5)), W, H, IMG)
    if (!r.ok) throw new Error('calibration failed')
    const p = { x: 123, y: 77 }
    const back = imageToWall(r.calibration, wallToImage(r.calibration, p))
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('maps the clicked corners onto the rectangle corners', () => {
    const q = quadOf(camera(20, 5))
    const r = calibratePerspective(q, W, H, IMG)
    if (!r.ok) throw new Error('calibration failed')
    corners.forEach((c, i) => {
      const w = imageToWall(r.calibration, q[i] ?? { x: NaN, y: NaN })
      expect(w.x).toBeCloseTo(c.x, 6)
      expect(w.y).toBeCloseTo(c.y, 6)
    })
    expect(r.calibration.quality.reprojPx).toBeLessThan(1e-6)
  })
})

describe('calibratePerspective: consistency of the entered size', () => {
  it('finds no deviation for matching width and height', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [20, 5],
      [-30, 10],
    ] as const) {
      const r = calibratePerspective(quadOf(camera(yaw, pitch)), W, H, IMG)
      if (!r.ok) throw new Error('calibration failed')
      expect(Math.abs(r.calibration.quality.aspectDeviation ?? 1)).toBeLessThan(0.01)
      expect(r.warnings).not.toContain('aspect-mismatch')
    }
  })

  it('flags a wrong height and suggests the right one', () => {
    const r = calibratePerspective(quadOf(camera(20, 5)), W, 300, IMG)
    if (!r.ok) throw new Error('calibration failed')
    expect(r.warnings).toContain('aspect-mismatch')
    expect(r.calibration.quality.impliedHeightCm).toBeCloseTo(H, -1)
    expect(Math.abs((r.calibration.quality.impliedHeightCm ?? 0) - H) / H).toBeLessThan(0.02)
  })

  it('flags a wrong width on a frontal photo', () => {
    const r = calibratePerspective(quadOf(camera(0, 0)), 300, H, IMG)
    if (!r.ok) throw new Error('calibration failed')
    expect(r.warnings).toContain('aspect-mismatch')
  })
})

describe('calibratePerspective: plausibility', () => {
  const run = (q: Pt[], w = 200, h = 100) => calibratePerspective(q as [Pt, Pt, Pt, Pt], w, h, IMG)
  const p = (x: number, y: number): Pt => ({ x, y })

  it('accepts a sane quad without warnings', () => {
    const r = run([p(500, 400), p(2500, 420), p(2520, 1500), p(480, 1480)], 400, 220)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })

  it('rejects collinear corners', () => {
    expect(run([p(100, 100), p(500, 100), p(900, 100), p(100, 500)])).toEqual({ ok: false, error: 'degenerate' })
  })

  it('rejects duplicated corners', () => {
    expect(run([p(100, 100), p(100, 100), p(900, 500), p(100, 500)])).toEqual({ ok: false, error: 'degenerate' })
  })

  it('rejects a self-intersecting (bow tie) quad', () => {
    expect(run([p(100, 100), p(500, 500), p(500, 100), p(100, 500)])).toEqual({ ok: false, error: 'not-convex' })
  })

  it('rejects the wrong corner order', () => {
    expect(run([p(100, 100), p(100, 500), p(500, 500), p(500, 100)])).toEqual({ ok: false, error: 'wrong-order' })
  })

  it('rejects a tiny quad', () => {
    expect(run([p(0, 0), p(15, 0), p(15, 15), p(0, 15)])).toEqual({ ok: false, error: 'degenerate' })
  })

  it('rejects extreme perspective (horizon almost inside the quad)', () => {
    expect(run([p(1000, 500), p(1100, 500), p(2500, 1900), p(500, 1900)])).toEqual({
      ok: false,
      error: 'degenerate',
    })
  })

  it('warns about strong perspective', () => {
    const r = run([p(1200, 700), p(1800, 700), p(2250, 1500), p(750, 1500)], 300, 200)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toContain('strong-perspective')
  })

  it('warns about short references and small areas', () => {
    const r = run([p(1000, 800), p(1300, 800), p(1300, 950), p(1000, 950)], 50, 30)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual(expect.arrayContaining(['short-reference', 'small-area']))
  })

  it('rejects invalid sizes', () => {
    const q = [p(500, 400), p(2500, 420), p(2520, 1500), p(480, 1480)]
    for (const [w, h] of [
      [0, 100],
      [100, 0],
      [-5, 100],
      [NaN, 100],
      [100, Infinity],
    ] as const) {
      expect(run(q, w, h)).toEqual({ ok: false, error: 'bad-size' })
    }
  })

  it('rejects non-finite corners', () => {
    expect(run([p(NaN, 0), p(100, 0), p(100, 100), p(0, 100)])).toEqual({ ok: false, error: 'degenerate' })
  })
})
