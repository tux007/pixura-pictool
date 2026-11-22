// Baseline TIFF writer: 8-bit RGB, little endian, strips of 64 rows, optional Deflate (zlib)
// compression. Hand-written because browsers cannot encode TIFF and the format is small.

const SHORT = 3
const LONG = 4
const ASCII = 2
const RATIONAL = 5
const ROWS = 64

export interface TiffOptions {
  compress?: boolean
  // TIFF/EXIF orientation 1..8 (mainly for tests)
  orientation?: number
}

type Entry = [tag: number, type: number, count: number, value: number]

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  writer.write(data as BufferSource).catch(() => {})
  writer.close().catch(() => {})
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

function words(values: number[], size: 2 | 4): Uint8Array {
  const out = new Uint8Array(values.length * size)
  const dv = new DataView(out.buffer)
  values.forEach((v, i) => (size === 2 ? dv.setUint16(i * 2, v, true) : dv.setUint32(i * 4, v, true)))
  return out
}

export async function buildTiff(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  opts: TiffOptions = {},
): Promise<Uint8Array> {
  if (!(w > 0 && h > 0) || !Number.isInteger(w) || !Number.isInteger(h) || rgba.length < w * h * 4) {
    throw new Error('invalid image data')
  }
  const compress = (opts.compress ?? true) && typeof CompressionStream !== 'undefined'
  const strips = Math.ceil(h / ROWS)

  const parts: Uint8Array[] = [new Uint8Array(8)] // header, filled in last
  let pos = 8
  // every block starts at an even offset, as TIFF requires for the IFD and word values
  const add = (u: Uint8Array): number => {
    const at = pos
    parts.push(u)
    pos += u.length
    if (pos & 1) {
      parts.push(new Uint8Array(1))
      pos++
    }
    return at
  }

  const offsets: number[] = []
  const counts: number[] = []
  for (let s = 0; s < strips; s++) {
    const y0 = s * ROWS
    const rows = Math.min(ROWS, h - y0)
    const raw = new Uint8Array(w * rows * 3)
    for (let i = 0, o = 0; i < w * rows; i++) {
      const p = (y0 * w + i) * 4
      raw[o++] = rgba[p] ?? 0
      raw[o++] = rgba[p + 1] ?? 0
      raw[o++] = rgba[p + 2] ?? 0
    }
    const data = compress ? await deflate(raw) : raw
    offsets.push(add(data))
    counts.push(data.length)
  }

  const bits = add(words([8, 8, 8], 2))
  const offsetList = strips > 1 ? add(words(offsets, 4)) : (offsets[0] ?? 0)
  const countList = strips > 1 ? add(words(counts, 4)) : (counts[0] ?? 0)
  const dpi = add(words([72, 1], 4))
  const software = new TextEncoder().encode('Pixura Wandvorschau\0')
  const softwareAt = add(software)

  const entries: Entry[] = [
    [256, LONG, 1, w],
    [257, LONG, 1, h],
    [258, SHORT, 3, bits],
    [259, SHORT, 1, compress ? 8 : 1],
    [262, SHORT, 1, 2],
    [273, LONG, strips, offsetList],
  ]
  if (opts.orientation) entries.push([274, SHORT, 1, opts.orientation])
  entries.push(
    [277, SHORT, 1, 3],
    [278, LONG, 1, ROWS],
    [279, LONG, strips, countList],
    [282, RATIONAL, 1, dpi],
    [283, RATIONAL, 1, dpi],
    [284, SHORT, 1, 1],
    [296, SHORT, 1, 2],
    [305, ASCII, software.length, softwareAt],
  )

  const ifd = new Uint8Array(2 + entries.length * 12 + 4)
  const dv = new DataView(ifd.buffer)
  dv.setUint16(0, entries.length, true)
  entries.forEach(([tag, type, count, value], i) => {
    const at = 2 + i * 12
    dv.setUint16(at, tag, true)
    dv.setUint16(at + 2, type, true)
    dv.setUint32(at + 4, count, true)
    if (type === SHORT && count === 1) dv.setUint16(at + 8, value, true)
    else dv.setUint32(at + 8, value, true)
  })
  const ifdAt = add(ifd)

  const head = new DataView((parts[0] as Uint8Array).buffer)
  head.setUint16(0, 0x4949, true) // "II"
  head.setUint16(2, 42, true)
  head.setUint32(4, ifdAt, true)

  const out = new Uint8Array(pos)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
