import type { Pt } from './view'

// Row-major 3x3 matrix.
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

const at = (m: Mat3, i: number): number => m[i] ?? 0

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = []
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += at(a, i * 3 + k) * at(b, k * 3 + j)
      r.push(s)
    }
  }
  return r as unknown as Mat3
}

export function inv3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const c11 = e * i - f * h
  const c12 = -(d * i - f * g)
  const c13 = d * h - e * g
  const det = a * c11 + b * c12 + c * c13
  const big = Math.max(...m.map(Math.abs))
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-15 * big ** 3) return null
  const k = 1 / det
  return [
    c11 * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    c12 * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    c13 * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ]
}

// Projective mapping; a zero denominator yields infinite coordinates.
export function apply3(m: Mat3, p: Pt): Pt {
  const w = at(m, 6) * p.x + at(m, 7) * p.y + at(m, 8)
  return {
    x: (at(m, 0) * p.x + at(m, 1) * p.y + at(m, 2)) / w,
    y: (at(m, 3) * p.x + at(m, 4) * p.y + at(m, 5)) / w,
  }
}

// Gaussian elimination with partial pivoting. Returns null for (near-)singular systems.
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i] ?? 0])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) {
      if (Math.abs(m[r]?.[c] ?? 0) > Math.abs(m[p]?.[c] ?? 0)) p = r
    }
    const pivotRow = m[p]
    const row = m[c]
    if (!pivotRow || !row || Math.abs(pivotRow[c] ?? 0) < 1e-12) return null
    m[c] = pivotRow
    m[p] = row
    for (let r = c + 1; r < n; r++) {
      const rr = m[r]
      if (!rr) return null
      const f = (rr[c] ?? 0) / (pivotRow[c] ?? 1)
      for (let k = c; k <= n; k++) rr[k] = (rr[k] ?? 0) - f * (pivotRow[k] ?? 0)
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    const row = m[i]
    if (!row) return null
    let s = row[n] ?? 0
    for (let j = i + 1; j < n; j++) s -= (row[j] ?? 0) * (x[j] ?? 0)
    x[i] = s / (row[i] ?? 1)
  }
  return x
}

// Hartley normalisation: centroid to origin, mean distance sqrt(2). Keeps the DLT well conditioned.
function normalizer(pts: readonly Pt[]): Mat3 {
  const n = pts.length
  const cx = pts.reduce((s, p) => s + p.x, 0) / n
  const cy = pts.reduce((s, p) => s + p.y, 0) / n
  const md = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n
  const s = md > 0 ? Math.SQRT2 / md : 1
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1]
}

// Direct linear transform from exactly four correspondences (8 equations, h33 = 1).
export function homographyFrom4(src: readonly Pt[], dst: readonly Pt[]): Mat3 | null {
  if (src.length !== 4 || dst.length !== 4) return null
  const ts = normalizer(src)
  const td = normalizer(dst)
  const rows: number[][] = []
  const rhs: number[] = []
  for (let i = 0; i < 4; i++) {
    const s = src[i]
    const d = dst[i]
    if (!s || !d) return null
    const p = apply3(ts, s)
    const q = apply3(td, d)
    rows.push([p.x, p.y, 1, 0, 0, 0, -q.x * p.x, -q.x * p.y])
    rhs.push(q.x)
    rows.push([0, 0, 0, p.x, p.y, 1, -q.y * p.x, -q.y * p.y])
    rhs.push(q.y)
  }
  const h = solveLinear(rows, rhs)
  const tdInv = inv3(td)
  if (!h || !tdInv || h.some((v) => !Number.isFinite(v))) return null
  const hn = [...h, 1] as unknown as Mat3
  const full = mul3(tdInv, mul3(hn, ts))
  const k = at(full, 8)
  return Math.abs(k) > 1e-9 ? (full.map((v) => v / k) as unknown as Mat3) : full
}
