// Generates placeholder PWA icons and the E2E fixture photo. Output is committed; rerun with `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(w, h, pixel) {
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y)
      const o = y * stride + 1 + x * 3
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const NAVY = [0x14, 0x21, 0x3d]
const WALL = [0xf3, 0xf1, 0xec]
const MOTIF = [0xfc, 0xa3, 0x11]

function icon(size, half) {
  return png(size, size, (x, y) => {
    const u = x / size - 0.5
    const v = y / size - 0.5
    if (Math.abs(u) < half * 0.5 && Math.abs(v + 0.04) < half * 0.4) return MOTIF
    if (Math.abs(u) < half * 1.2 && Math.abs(v) < half) return WALL
    return NAVY
  })
}

mkdirSync('public/icons', { recursive: true })
writeFileSync('public/icons/icon-192.png', icon(192, 0.3))
writeFileSync('public/icons/icon-512.png', icon(512, 0.3))
writeFileSync('public/icons/icon-maskable-512.png', icon(512, 0.24))
writeFileSync('public/icons/apple-touch-icon.png', icon(180, 0.3))

mkdirSync('e2e/fixtures', { recursive: true })
writeFileSync(
  'e2e/fixtures/wall.png',
  png(1200, 800, (x, y) => {
    if (x >= 800 && x < 1000 && y >= 200) return [0x7a, 0x52, 0x30]
    if (x % 100 === 0 || y % 100 === 0) return [0xc9, 0xc2, 0xb0]
    return [0xef, 0xe9, 0xdc]
  }),
)
console.log('icons and fixture written')
