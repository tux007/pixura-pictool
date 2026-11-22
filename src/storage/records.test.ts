import { describe, expect, it } from 'vitest'
import type { Project } from '../model/types'
import { defaultName, formatStamp, newId, summary, toFile, toRecord, validateRecord } from './records'

const file = (name: string, type = 'image/jpeg'): File => new File([new Uint8Array([1, 2, 3])], name, { type })
const fakeBitmap = {} as ImageBitmap

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'abc',
    name: 'Projekt 1',
    updated: 1_700_000_000_000,
    wall: {
      image: fakeBitmap,
      source: file('wand.jpg'),
      width: 4000,
      height: 3000,
      calibration: { mode: 'linear', pxPerCm: 2.5 },
    },
    variants: [
      {
        image: fakeBitmap,
        source: file('motiv.png', 'image/png'),
        box: { x: 100, y: 80, w: 120, h: 80, rot: 15 },
        aspect: 1.5,
        opacity: 80,
        lockAspect: true,
      },
    ],
    active: 0,
    guides: { floor: 240, left: 10 },
    showDims: true,
    toleranceCm: 5,
    ...over,
  }
}

describe('toRecord', () => {
  it('captures the whole project with the original files', () => {
    const r = toRecord(project(), null)
    expect(r.id).toBe('abc')
    expect(r.wall).toMatchObject({ name: 'wand.jpg', type: 'image/jpeg' })
    expect(r.wall.blob).toBeInstanceOf(Blob)
    expect(r.variants[0]).toMatchObject({ name: 'motiv.png', opacity: 80, aspect: 1.5 })
    expect(r.guides).toEqual({ floor: 240, left: 10 })
    expect(r.calibration).toEqual({ mode: 'linear', pxPerCm: 2.5 })
  })

  it('copies mutable data instead of sharing it', () => {
    const p = project()
    const r = toRecord(p, null)
    p.guides.floor = 1
    p.variants[0]!.box.x = 0
    expect(r.guides.floor).toBe(240)
    expect(r.variants[0]?.box.x).toBe(100)
  })

  it('refuses a project without a wall', () => {
    expect(() => toRecord(project({ wall: null }), null)).toThrow()
  })

  it('rebuilds a file with name and type', async () => {
    const r = toRecord(project(), null)
    const f = toFile(r.wall)
    expect(f.name).toBe('wand.jpg')
    expect(f.type).toBe('image/jpeg')
    expect(f.size).toBe(3)
  })
})

describe('validateRecord', () => {
  const good = () => toRecord(project(), new Blob(['t']))

  it('accepts a freshly serialised project', () => {
    expect(validateRecord(good())).not.toBeNull()
  })

  it('accepts a perspective calibration and an empty project', () => {
    const r = good()
    r.calibration = {
      mode: 'perspective',
      h: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      hInv: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      widthCm: 200,
      heightCm: 100,
      quad: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      quality: { reprojPx: 0, reprojCm: 0, aspectDeviation: null, impliedHeightCm: null },
    }
    r.variants = []
    r.active = 0
    expect(validateRecord(r)).not.toBeNull()
  })

  it('rejects junk and wrong versions', () => {
    for (const bad of [null, 5, 'x', {}, [], { ...good(), version: 2 }]) {
      expect(validateRecord(bad)).toBeNull()
    }
  })

  it('rejects broken fields', () => {
    const cases: ((r: ReturnType<typeof good>) => unknown)[] = [
      (r) => ({ ...r, id: '' }),
      (r) => ({ ...r, updated: NaN }),
      (r) => ({ ...r, wall: { ...r.wall, blob: 'nope' } }),
      (r) => ({ ...r, calibration: { mode: 'linear', pxPerCm: 0 } }),
      (r) => ({ ...r, calibration: { mode: 'perspective', h: [1] } }),
      (r) => ({ ...r, variants: [{ ...r.variants[0], box: { x: 1, y: 1, w: 0, h: 5, rot: 0 } }] }),
      (r) => ({ ...r, variants: [...r.variants, ...r.variants, ...r.variants, ...r.variants] }),
      (r) => ({ ...r, active: 5 }),
      (r) => ({ ...r, active: -1 }),
      (r) => ({ ...r, guides: { floor: 'x' } }),
      (r) => ({ ...r, guides: { roof: 1 } }),
      (r) => ({ ...r, showDims: 'yes' }),
      (r) => ({ ...r, toleranceCm: Infinity }),
      (r) => ({ ...r, thumb: 'x' }),
    ]
    for (const make of cases) expect(validateRecord(make(good()))).toBeNull()
  })
})

describe('helpers', () => {
  it('creates unique v4 ids', () => {
    const a = newId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(newId()).not.toBe(a)
  })

  it('formats Swiss date and time', () => {
    const ms = new Date(2026, 10, 22, 9, 5).getTime()
    expect(formatStamp(ms)).toBe('22.11.2026, 09:05')
    expect(defaultName(ms)).toBe('Projekt 22.11.2026 09:05')
  })

  it('summarises a record for the list', () => {
    const s = summary(toRecord(project(), null))
    expect(s).toMatchObject({ id: 'abc', variants: 1, calibrated: true, thumb: null })
  })
})
