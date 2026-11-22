import { describe, expect, it } from 'vitest'
import { apply3, homographyFrom4, IDENTITY, inv3, mul3, solveLinear, type Mat3 } from './homography'

const rect = [
  { x: 0, y: 0 },
  { x: 400, y: 0 },
  { x: 400, y: 250 },
  { x: 0, y: 250 },
]

describe('solveLinear', () => {
  it('solves a small system', () => {
    const x = solveLinear(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    )
    expect(x?.[0]).toBeCloseTo(1)
    expect(x?.[1]).toBeCloseTo(3)
  })

  it('needs row swaps (zero pivot)', () => {
    const x = solveLinear(
      [
        [0, 1],
        [1, 0],
      ],
      [2, 3],
    )
    expect(x).toEqual([3, 2])
  })

  it('returns null for singular systems', () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull()
  })
})

describe('inv3 / mul3', () => {
  const m: Mat3 = [2, 1, 5, 0, 3, -4, 0.001, 0.002, 1]

  it('inverts', () => {
    const inv = inv3(m)
    expect(inv).not.toBeNull()
    if (!inv) return
    const p = mul3(m, inv)
    IDENTITY.forEach((v, i) => expect(p[i]).toBeCloseTo(v, 9))
  })

  it('rejects singular matrices', () => {
    expect(inv3([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull()
  })
})

describe('homographyFrom4', () => {
  it('reproduces a pure scale and translation', () => {
    const dst = rect.map((p) => ({ x: 2 * p.x + 100, y: 2 * p.y + 50 }))
    const h = homographyFrom4(rect, dst)
    expect(h).not.toBeNull()
    if (!h) return
    const q = apply3(h, { x: 200, y: 100 })
    expect(q.x).toBeCloseTo(500)
    expect(q.y).toBeCloseTo(250)
  })

  it('maps the four correspondences exactly for a perspective quad', () => {
    const dst = [
      { x: 1200, y: 700 },
      { x: 1800, y: 650 },
      { x: 2250, y: 1500 },
      { x: 750, y: 1450 },
    ]
    const h = homographyFrom4(rect, dst)
    expect(h).not.toBeNull()
    if (!h) return
    rect.forEach((p, i) => {
      const q = apply3(h, p)
      expect(q.x).toBeCloseTo(dst[i]?.x ?? NaN, 6)
      expect(q.y).toBeCloseTo(dst[i]?.y ?? NaN, 6)
    })
  })

  it('preserves straight lines (midpoint of an edge lies on the image edge)', () => {
    const dst = [
      { x: 1200, y: 700 },
      { x: 1800, y: 650 },
      { x: 2250, y: 1500 },
      { x: 750, y: 1450 },
    ]
    const h = homographyFrom4(rect, dst)
    if (!h) throw new Error('no homography')
    const m = apply3(h, { x: 200, y: 0 })
    const [a, b] = [dst[0], dst[1]]
    if (!a || !b) throw new Error('bad fixture')
    const cross = (b.x - a.x) * (m.y - a.y) - (b.y - a.y) * (m.x - a.x)
    expect(Math.abs(cross)).toBeLessThan(1e-6)
  })

  it('is well conditioned for pixel-sized coordinates', () => {
    const dst = rect.map((p) => ({ x: 3000 + p.x * 8, y: 2000 + p.y * 8 }))
    const h = homographyFrom4(rect, dst)
    expect(h).not.toBeNull()
    if (!h) return
    const q = apply3(h, { x: 123, y: 45 })
    expect(q.x).toBeCloseTo(3000 + 123 * 8, 6)
    expect(q.y).toBeCloseTo(2000 + 45 * 8, 6)
  })

  it('returns null for collinear points', () => {
    const line = [0, 100, 200, 300].map((x) => ({ x, y: x }))
    expect(homographyFrom4(line, rect)).toBeNull()
    expect(homographyFrom4(rect, line)).toBeNull()
  })

  it('returns null for coincident points', () => {
    const p = { x: 5, y: 5 }
    expect(homographyFrom4([p, p, p, p], rect)).toBeNull()
  })
})
