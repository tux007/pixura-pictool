// Minimal single-page PDF: one JPEG image, a title and a few text lines in standard Helvetica.
// Hand-written instead of a library: the file layout is tiny and fully covered by tests.

const PORTRAIT = { w: 595, h: 842 } // A4 in points
const MARGIN = 36
const LINE = 14

export interface PdfInput {
  jpeg: Uint8Array
  imgW: number
  imgH: number
  title: string
  lines: readonly string[]
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c < 256 ? c : 63
  }
  return out
}

// Literal string with everything outside printable ASCII as octal (WinAnsi = Latin-1 for those).
export function pdfString(s: string): string {
  let out = '('
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 63
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch
    else if (c < 32 || c > 126) out += '\\' + (c < 256 ? c : 63).toString(8).padStart(3, '0')
    else out += ch
  }
  return out + ')'
}

const num = (v: number): string => String(Math.round(v * 100) / 100)

export function buildPdf(input: PdfInput): Uint8Array {
  const landscape = input.imgW >= input.imgH
  const pw = landscape ? PORTRAIT.h : PORTRAIT.w
  const ph = landscape ? PORTRAIT.w : PORTRAIT.h

  const titleY = ph - MARGIN - 14
  const top = titleY - 14
  const bottom = MARGIN + input.lines.length * LINE + 10
  const boxW = pw - 2 * MARGIN
  const boxH = top - bottom
  const k = Math.min(boxW / input.imgW, boxH / input.imgH)
  const dw = input.imgW * k
  const dh = input.imgH * k
  const dx = (pw - dw) / 2
  const dy = bottom + (boxH - dh) / 2

  let content = `q ${num(dw)} 0 0 ${num(dh)} ${num(dx)} ${num(dy)} cm /Im1 Do Q\n`
  content += `BT /F2 16 Tf ${MARGIN} ${num(titleY)} Td ${pdfString(input.title)} Tj ET\n`
  input.lines.forEach((line, i) => {
    const y = MARGIN + (input.lines.length - 1 - i) * LINE
    content += `BT /F1 10 Tf ${MARGIN} ${y} Td ${pdfString(line)} Tj ET\n`
  })

  const parts: Uint8Array[] = []
  let pos = 0
  const add = (d: string | Uint8Array): void => {
    const u = typeof d === 'string' ? latin1(d) : d
    parts.push(u)
    pos += u.length
  }
  const offsets: number[] = []
  const obj = (id: number, body: string): void => {
    offsets[id] = pos
    add(`${id} 0 obj\n${body}\nendobj\n`)
  }

  add('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] ` +
      '/Resources << /Font << /F1 6 0 R /F2 7 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
  )
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}endstream`)
  offsets[5] = pos
  add(
    `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${input.imgW} /Height ${input.imgH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${input.jpeg.length} >>\nstream\n`,
  )
  add(input.jpeg)
  add('\nendstream\nendobj\n')
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  obj(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  obj(8, `<< /Title ${pdfString(input.title)} /Producer (Pixura Wandvorschau) >>`)

  const xref = pos
  add('xref\n0 9\n0000000000 65535 f \n')
  for (let id = 1; id <= 8; id++) add(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`)
  add(`trailer\n<< /Size 9 /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(pos)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
