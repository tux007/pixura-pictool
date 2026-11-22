import { describe, expect, it } from 'vitest'
import { decodeTiff } from '../image/tiff'
import { buildTiff } from './tiff'

function gradient(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = (x * 7 + y) & 255
      d[i + 1] = (y * 5 + x * 3) & 255
      d[i + 2] = (x + y * 11) & 255
      d[i + 3] = 255
    }
  }
  return d
}

const buf = (t: Uint8Array): ArrayBuffer => t.buffer.slice(t.byteOffset, t.byteOffset + t.length) as ArrayBuffer

describe('buildTiff', () => {
  for (const compress of [false, true]) {
    it(`round-trips pixel for pixel through the decoder (compress ${compress})`, async () => {
      const src = gradient(37, 23)
      const tiff = await buildTiff(src, 37, 23, { compress })
      const out = decodeTiff(buf(tiff))
      expect([out.width, out.height]).toEqual([37, 23])
      expect([...out.data]).toEqual([...src])
    })
  }

  it('starts with a little-endian TIFF header and an even IFD offset', async () => {
    const t = await buildTiff(gradient(5, 5), 5, 5)
    expect([...t.slice(0, 4)]).toEqual([0x49, 0x49, 0x2a, 0x00])
    expect(new DataView(t.buffer).getUint32(4, true) % 2).toBe(0)
  })

  it('splits tall images into several strips', async () => {
    const src = gradient(20, 150)
    const out = decodeTiff(buf(await buildTiff(src, 20, 150)))
    expect(out.height).toBe(150)
    expect([...out.data]).toEqual([...src])
  })

  it('handles a single row and a single column', async () => {
    for (const [w, h] of [
      [64, 1],
      [1, 64],
      [1, 1],
    ] as const) {
      const src = gradient(w, h)
      const out = decodeTiff(buf(await buildTiff(src, w, h)))
      expect([out.width, out.height]).toEqual([w, h])
      expect([...out.data]).toEqual([...src])
    }
  })

  it('compresses flat areas', async () => {
    const flat = new Uint8ClampedArray(200 * 200 * 4).fill(200)
    const plain = await buildTiff(flat, 200, 200, { compress: false })
    const small = await buildTiff(flat, 200, 200, { compress: true })
    expect(small.length).toBeLessThan(plain.length / 10)
  })

  it('writes the orientation tag and the decoder applies it', async () => {
    // 3 x 2 source: a b c / d e f, stored with orientation 6 (rotate 90 degrees clockwise)
    const ids = [10, 20, 30, 40, 50, 60]
    const src = new Uint8ClampedArray(ids.flatMap((v) => [v, 0, 0, 255]))
    const out = decodeTiff(buf(await buildTiff(src, 3, 2, { orientation: 6 })))
    expect([out.width, out.height]).toEqual([2, 3])
    const red = Array.from({ length: 6 }, (_, i) => out.data[i * 4])
    expect(red).toEqual([40, 10, 50, 20, 60, 30])
  })

  it('rejects invalid input', async () => {
    await expect(buildTiff(new Uint8Array(4), 0, 1)).rejects.toThrow()
    await expect(buildTiff(new Uint8Array(4), 2, 2)).rejects.toThrow()
    await expect(buildTiff(new Uint8Array(16), 1.5, 2)).rejects.toThrow()
  })
})
