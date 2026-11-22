import { describe, expect, it } from 'vitest'
import { buildTiff } from '../export/tiff'
import { isTiff } from './load'
import { decodeTiff, MAX_TIFF_PIXELS, orient, TiffError, type Rgba } from './tiff'

// 3 x 2 test image, one id per pixel: a b c / d e f  ->  10 20 30 / 40 50 60
const ids = [10, 20, 30, 40, 50, 60]
const sample = (): Rgba => ({
  width: 3,
  height: 2,
  data: new Uint8ClampedArray(ids.flatMap((v) => [v, 0, 0, 255])),
})
const reds = (img: Rgba): number[] => Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4] ?? -1)

describe('isTiff', () => {
  it('recognises both byte orders', () => {
    expect(isTiff(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe(true)
    expect(isTiff(new Uint8Array([0x4d, 0x4d, 0, 0x2a]))).toBe(true)
  })

  it('rejects other formats, BigTIFF and short input', () => {
    expect(isTiff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false)
    expect(isTiff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false)
    expect(isTiff(new Uint8Array([0x49, 0x49, 0x2b, 0]))).toBe(false)
    expect(isTiff(new Uint8Array([0x49, 0x49]))).toBe(false)
  })
})

describe('orient', () => {
  const [a, b, c, d, e, f] = ids as [number, number, number, number, number, number]
  const cases: [number, number, number, number[]][] = [
    [1, 3, 2, [a, b, c, d, e, f]],
    [2, 3, 2, [c, b, a, f, e, d]], // mirror horizontally
    [3, 3, 2, [f, e, d, c, b, a]], // rotate 180
    [4, 3, 2, [d, e, f, a, b, c]], // mirror vertically
    [5, 2, 3, [a, d, b, e, c, f]], // transpose
    [6, 2, 3, [d, a, e, b, f, c]], // rotate 90 clockwise
    [7, 2, 3, [f, c, e, b, d, a]], // transverse
    [8, 2, 3, [c, f, b, e, a, d]], // rotate 90 counter-clockwise
  ]

  for (const [o, w, h, expected] of cases) {
    it(`orientation ${o}`, () => {
      const r = orient(sample(), o)
      expect([r.width, r.height]).toEqual([w, h])
      expect(reds(r)).toEqual(expected)
    })
  }

  it('leaves unknown values alone', () => {
    for (const o of [0, 9, -1, 1.5, NaN]) expect(reds(orient(sample(), o))).toEqual(ids)
  })

  it('keeps alpha and does not touch the input', () => {
    const src = sample()
    const r = orient(src, 6)
    expect(r.data[3]).toBe(255)
    expect(reds(src)).toEqual(ids)
  })
})

describe('decodeTiff', () => {
  const ab = (t: Uint8Array): ArrayBuffer => t.buffer.slice(t.byteOffset, t.byteOffset + t.length) as ArrayBuffer

  it('rejects data that is not a TIFF', () => {
    for (const junk of [new Uint8Array(0), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), new Uint8Array(64).fill(0x49)]) {
      expect(() => decodeTiff(ab(junk))).toThrow(TiffError)
    }
  })

  it('rejects a TIFF header without an image', () => {
    const head = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => decodeTiff(ab(head))).toThrow(TiffError)
  })

  it('refuses images above the pixel limit before decoding them', async () => {
    const t = await buildTiff(new Uint8Array(16), 2, 2, { compress: false })
    // patch ImageWidth/ImageLength in the first two IFD entries
    const dv = new DataView(t.buffer, t.byteOffset)
    const ifd = dv.getUint32(4, true)
    dv.setUint32(ifd + 2 + 8, 20_000, true)
    dv.setUint32(ifd + 2 + 12 + 8, Math.ceil(MAX_TIFF_PIXELS / 20_000) + 1, true)
    try {
      decodeTiff(ab(t))
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(TiffError)
      expect((err as TiffError).kind).toBe('too-big')
    }
  })

  it('reads a plain single-image file', async () => {
    const t = await buildTiff(new Uint8Array(4 * 4 * 4).fill(255), 4, 4, { compress: false })
    const out = decodeTiff(ab(t))
    expect([out.width, out.height]).toEqual([4, 4])
  })
})
