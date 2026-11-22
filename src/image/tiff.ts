import UTIF from 'utif'
import type { IFD } from 'utif'

// Decoding needs the whole image in memory (compressed data, decoded samples and RGBA),
// so very large print files are refused instead of crashing the tab.
export const MAX_TIFF_PIXELS = 50_000_000

export class TiffError extends Error {
  constructor(
    readonly kind: 'format' | 'too-big',
    message: string,
  ) {
    super(message)
  }
}

export interface Rgba {
  width: number
  height: number
  data: Uint8ClampedArray
}

// Applies the EXIF/TIFF orientation tag (1..8) so the pixels are upright.
export function orient(img: Rgba, o: number): Rgba {
  if (!Number.isInteger(o) || o < 2 || o > 8) return img
  const { width: w, height: h } = img
  const swap = o >= 5
  const ow = swap ? h : w
  const oh = swap ? w : h
  const src = new Uint32Array(img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + w * h * 4))
  const dst = new Uint32Array(ow * oh)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx = x
      let ny = y
      switch (o) {
        case 2:
          nx = w - 1 - x
          break
        case 3:
          nx = w - 1 - x
          ny = h - 1 - y
          break
        case 4:
          ny = h - 1 - y
          break
        case 5:
          nx = y
          ny = x
          break
        case 6:
          nx = h - 1 - y
          ny = x
          break
        case 7:
          nx = h - 1 - y
          ny = w - 1 - x
          break
        case 8:
          nx = y
          ny = w - 1 - x
          break
      }
      dst[ny * ow + nx] = src[y * w + x] ?? 0
    }
  }
  return { width: ow, height: oh, data: new Uint8ClampedArray(dst.buffer) }
}

const first = (v: unknown): number => {
  const n = Array.isArray(v) || ArrayBuffer.isView(v) ? Number((v as ArrayLike<number>)[0]) : Number(v)
  return Number.isFinite(n) ? n : 0
}

const area = (ifd: IFD): number => first(ifd['t256']) * first(ifd['t257'])

// Decodes the largest image in the file to upright 8-bit RGBA. Grey, RGB, palette and CMYK
// are converted without colour management (the tool is about size and position, not colour).
export function decodeTiff(buffer: ArrayBuffer): Rgba {
  let ifds: IFD[]
  try {
    ifds = UTIF.decode(buffer)
  } catch {
    throw new TiffError('format', 'not a readable TIFF')
  }
  // reduced-resolution thumbnails are stored as extra images; take the biggest one
  const ifd = ifds.filter((i) => area(i) > 0).sort((a, b) => area(b) - area(a))[0]
  if (!ifd) throw new TiffError('format', 'no image in file')
  if (area(ifd) > MAX_TIFF_PIXELS) throw new TiffError('too-big', 'image has too many pixels')

  let rgba: Uint8Array
  try {
    UTIF.decodeImage(buffer, ifd)
    rgba = UTIF.toRGBA8(ifd)
  } catch {
    throw new TiffError('format', 'unsupported TIFF')
  }
  const { width, height } = ifd
  if (!(width > 0 && height > 0) || rgba.length !== width * height * 4) {
    throw new TiffError('format', 'unsupported TIFF')
  }
  const data = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length)
  return orient({ width, height, data }, first(ifd['t274']) || 1)
}
