import { describe, expect, it } from 'vitest'
import { fitWithin } from './size'

describe('fitWithin', () => {
  it('keeps images that are small enough', () => {
    expect(fitWithin(4096, 3000, 4096)).toEqual({ w: 4096, h: 3000 })
    expect(fitWithin(800, 600, 4096)).toEqual({ w: 800, h: 600 })
  })

  it('scales a 12 MP photo (4000x3000 is fine, 5712x4284 is not)', () => {
    expect(fitWithin(4000, 3000, 4096)).toEqual({ w: 4000, h: 3000 })
    const r = fitWithin(5712, 4284, 4096)
    expect(r.w).toBe(4096)
    expect(r.h).toBe(3072)
  })

  it('handles portrait', () => {
    expect(fitWithin(3000, 8000, 4096)).toEqual({ w: 1536, h: 4096 })
  })

  it('never returns zero for extreme aspect ratios', () => {
    expect(fitWithin(100000, 10, 4096).h).toBe(1)
  })

  it('passes invalid sizes through', () => {
    expect(fitWithin(0, 0, 4096)).toEqual({ w: 0, h: 0 })
  })
})
