import { describe, expect, it } from 'vitest'
import { calibratePerspective } from './perspective'
import { guideDistances, guideEndpoints, guideValueAt } from './guides'
import type { Box } from './motif'
import type { Pt } from './view'

const box = (over: Partial<Box> = {}): Box => ({ x: 200, y: 150, w: 100, h: 50, rot: 0, ...over })
const find = (d: ReturnType<typeof guideDistances>, kind: string) => d.find((x) => x.kind === kind)

describe('guideDistances', () => {
  const all = { floor: 300, ceiling: 0, left: 0, right: 500 }

  it('measures from the motif edges to each line', () => {
    const d = guideDistances(box(), all)
    expect(find(d, 'floor')?.cm).toBeCloseTo(125) // 300 - 175
    expect(find(d, 'ceiling')?.cm).toBeCloseTo(125) // 125 - 0
    expect(find(d, 'left')?.cm).toBeCloseTo(150) // 150 - 0
    expect(find(d, 'right')?.cm).toBeCloseTo(250) // 500 - 250
  })

  it('only reports lines that are set', () => {
    const d = guideDistances(box(), { floor: 300 })
    expect(d.map((x) => x.kind)).toEqual(['floor'])
  })

  it('draws the segment from the edge centre straight to the line', () => {
    const f = find(guideDistances(box(), { floor: 300 }), 'floor')
    expect(f?.from).toEqual({ x: 200, y: 175 })
    expect(f?.to).toEqual({ x: 200, y: 300 })
    const l = find(guideDistances(box(), { left: 0 }), 'left')
    expect(l?.from).toEqual({ x: 150, y: 150 })
    expect(l?.to).toEqual({ x: 0, y: 150 })
  })

  it('uses the rotated bounding box', () => {
    const d = guideDistances(box({ rot: 90 }), all) // now 50 wide, 100 high
    expect(find(d, 'floor')?.cm).toBeCloseTo(300 - 200)
    expect(find(d, 'left')?.cm).toBeCloseTo(175)
    const e = guideDistances(box({ rot: 45 }), { left: 0 })
    expect(find(e, 'left')?.cm).toBeCloseTo(200 - ((100 + 50) * Math.SQRT1_2) / 2)
  })

  it('goes negative when the motif crosses a line', () => {
    const d = guideDistances(box(), { floor: 160 })
    expect(find(d, 'floor')?.cm).toBeCloseTo(-15)
  })
})

describe('guideValueAt', () => {
  it('takes y for floor/ceiling and x for the edges', () => {
    const p: Pt = { x: 12, y: 34 }
    expect(guideValueAt('floor', p)).toBe(34)
    expect(guideValueAt('ceiling', p)).toBe(34)
    expect(guideValueAt('left', p)).toBe(12)
    expect(guideValueAt('right', p)).toBe(12)
  })
})

describe('guideEndpoints', () => {
  const img = { w: 2000, h: 1000 }

  it('spans the photo for a linear calibration', () => {
    const cal = { mode: 'linear', pxPerCm: 2 } as const
    expect(guideEndpoints(cal, img, 'floor', 300)).toEqual([
      { x: 0, y: 300 },
      { x: 1000, y: 300 },
    ])
    expect(guideEndpoints(cal, img, 'left', 40)).toEqual([
      { x: 40, y: 0 },
      { x: 40, y: 500 },
    ])
  })

  it('extends beyond the calibration rectangle when that stays in front of the camera', () => {
    const r = calibratePerspective(
      [
        { x: 500, y: 300 },
        { x: 1500, y: 320 },
        { x: 1520, y: 800 },
        { x: 480, y: 780 },
      ],
      200,
      100,
      img,
    )
    if (!r.ok) throw new Error('calibration failed')
    const [a, b] = guideEndpoints(r.calibration, img, 'floor', 100)
    expect(a.x).toBeCloseTo(-100)
    expect(b.x).toBeCloseTo(300)
  })
})
