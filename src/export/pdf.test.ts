import { describe, expect, it } from 'vitest'
import { buildPdf, pdfString } from './pdf'

const dec = new TextDecoder('latin1')
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9])

function find(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

const make = (over: Partial<Parameters<typeof buildPdf>[0]> = {}) =>
  buildPdf({
    jpeg,
    imgW: 1200,
    imgH: 800,
    title: 'Pixura Wandvorschau - Variante 1',
    lines: ['Motiv 200,0 × 133,3 cm', 'Vorschau, Massangaben ca. ±5 cm'],
    ...over,
  })

describe('pdfString', () => {
  it('escapes delimiters and backslashes', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)')
  })

  it('writes Latin-1 characters as octal (umlauts, plus-minus, multiplication sign)', () => {
    expect(pdfString('ü')).toBe('(\\374)')
    expect(pdfString('±')).toBe('(\\261)')
    expect(pdfString('×')).toBe('(\\327)')
  })

  it('replaces characters outside Latin-1', () => {
    expect(pdfString('€')).toBe('(\\077)')
  })
})

describe('buildPdf', () => {
  it('has a valid header and trailer', () => {
    const pdf = make()
    expect(dec.decode(pdf.slice(0, 8))).toBe('%PDF-1.4')
    expect(dec.decode(pdf.slice(-6))).toBe('%%EOF\n')
  })

  it('has an xref table whose offsets point at the objects', () => {
    const pdf = make()
    const text = dec.decode(pdf)
    const start = Number(/startxref\n(\d+)\n/.exec(text)?.[1])
    expect(text.slice(start, start + 4)).toBe('xref')
    const entries = text.slice(start).split('\n').slice(3, 11)
    expect(entries).toHaveLength(8)
    entries.forEach((e, i) => {
      expect(e).toMatch(/^\d{10} 00000 n $/)
      const off = Number(e.slice(0, 10))
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`)
    })
  })

  it('embeds the JPEG bytes unchanged and declares their length', () => {
    const pdf = make()
    expect(find(pdf, jpeg)).toBeGreaterThan(0)
    expect(dec.decode(pdf)).toContain(`/Filter /DCTDecode /Length ${jpeg.length}`)
  })

  it('declares matching stream lengths for the page content', () => {
    const text = dec.decode(make())
    const m = /4 0 obj\n<< \/Length (\d+) >>\nstream\n([\s\S]*?)endstream/.exec(text)
    expect(Number(m?.[1])).toBe(m?.[2]?.length)
  })

  it('puts the text lines on the page', () => {
    const text = dec.decode(make())
    expect(text).toContain('Vorschau, Massangaben ca. \\2615 cm')
    expect(text).toContain('Motiv 200,0 \\327 133,3 cm')
  })

  it('picks the page orientation from the image', () => {
    expect(dec.decode(make())).toContain('/MediaBox [0 0 842 595]')
    expect(dec.decode(make({ imgW: 800, imgH: 1200 }))).toContain('/MediaBox [0 0 595 842]')
  })

  it('keeps the image inside the page margins', () => {
    const text = dec.decode(make({ lines: ['a', 'b', 'c', 'd'] }))
    const m = /q ([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm/.exec(text)
    const [w, h, x, y] = [m?.[1], m?.[2], m?.[3], m?.[4]].map(Number) as [number, number, number, number]
    expect(x).toBeGreaterThanOrEqual(36)
    expect(x + w).toBeLessThanOrEqual(842 - 36 + 0.01)
    expect(y).toBeGreaterThanOrEqual(36 + 4 * 14)
    expect(y + h).toBeLessThanOrEqual(595 - 36)
  })
})
