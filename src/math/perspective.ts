import type { PerspectiveCalibration } from '../model/types'
import { apply3, homographyFrom4, inv3, type Mat3 } from './homography'
import type { Pt, Size } from './view'

export interface PerspectiveQuality {
  // Max distance between the four clicked corners and their mapped wall corners.
  // Four points are fitted exactly, so this only guards against numerical trouble.
  reprojPx: number
  reprojCm: number
  // Signed (ratio - 1) of the rectangle's side scales, estimated from the photo with the
  // principal point at the image centre. Near 0 when width and height match the photo.
  aspectDeviation: number | null
  // Height the photo suggests for the entered width/height ratio.
  impliedHeightCm: number | null
}

export type PerspectiveError = 'bad-size' | 'degenerate' | 'not-convex' | 'wrong-order'
export type PerspectiveWarning = 'short-reference' | 'strong-perspective' | 'aspect-mismatch' | 'small-area'

export type PerspectiveResult =
  | { ok: true; calibration: PerspectiveCalibration; warnings: PerspectiveWarning[] }
  | { ok: false; error: PerspectiveError }

export const MIN_SIN = 0.1
export const MIN_EDGE_PX = 5
export const MIN_AREA_PX = 400
export const MAX_SCALE_RATIO = 8
export const WARN_SCALE_RATIO = 2
export const WARN_ASPECT = 0.08
export const WARN_AREA_FRACTION = 0.03
export const SHORT_REF_CM = 100

type Quad = readonly [Pt, Pt, Pt, Pt]

// Ratio |K^-1 h1| / |K^-1 h2| for K = diag(f, f, 1) at the image centre, f from h1 . w h2 = 0.
// Equals 1 when the wall dimensions behind H are metrically consistent.
export function sideScaleRatio(h: Mat3, img: Size): number | null {
  const cx = img.w / 2
  const cy = img.h / 2
  const [h0, h1, , h3, h4, , h6, h7] = h
  const a = [h0 - cx * h6, h3 - cy * h6, h6] as const
  const b = [h1 - cx * h7, h4 - cy * h7, h7] as const
  const diag = Math.hypot(img.w, img.h)
  const z = a[2] * b[2]
  let f2 = Infinity
  if (Math.abs(z) > 1e-18) {
    const c = -(a[0] * b[0] + a[1] * b[1]) / z
    if (c >= (0.25 * diag) ** 2 && c <= (8 * diag) ** 2) f2 = c
  }
  const norm = (v: readonly [number, number, number]): number =>
    Number.isFinite(f2) ? Math.sqrt((v[0] ** 2 + v[1] ** 2) / f2 + v[2] ** 2) : Math.hypot(v[0], v[1])
  const nb = norm(b)
  return nb > 0 ? norm(a) / nb : null
}

// Four clicked corners (top-left, top-right, bottom-right, bottom-left, clockwise on screen) of
// a rectangle with known width and height. Wall coordinates: cm, origin at the rectangle's top-left.
export function calibratePerspective(
  quad: Quad,
  widthCm: number,
  heightCm: number,
  img: Size,
  opts: { wall?: boolean } = {},
): PerspectiveResult {
  if (!(widthCm > 0 && heightCm > 0) || !Number.isFinite(widthCm) || !Number.isFinite(heightCm)) {
    return { ok: false, error: 'bad-size' }
  }
  if (quad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { ok: false, error: 'degenerate' }

  let positive = 0
  let negative = 0
  for (let i = 0; i < 4; i++) {
    const p0 = quad[i]
    const p1 = quad[(i + 1) % 4]
    const p2 = quad[(i + 2) % 4]
    if (!p0 || !p1 || !p2) return { ok: false, error: 'degenerate' }
    const e1 = { x: p1.x - p0.x, y: p1.y - p0.y }
    const e2 = { x: p2.x - p1.x, y: p2.y - p1.y }
    const l1 = Math.hypot(e1.x, e1.y)
    const l2 = Math.hypot(e2.x, e2.y)
    if (l1 < MIN_EDGE_PX || l2 < MIN_EDGE_PX) return { ok: false, error: 'degenerate' }
    const sin = (e1.x * e2.y - e1.y * e2.x) / (l1 * l2)
    if (Math.abs(sin) < MIN_SIN) return { ok: false, error: 'degenerate' }
    if (sin > 0) positive++
    else negative++
  }
  if (positive > 0 && negative > 0) return { ok: false, error: 'not-convex' }
  if (negative > 0) return { ok: false, error: 'wrong-order' }

  let area = 0
  for (let i = 0; i < 4; i++) {
    const p = quad[i]
    const q = quad[(i + 1) % 4]
    if (p && q) area += p.x * q.y - q.x * p.y
  }
  area = Math.abs(area) / 2
  if (area < MIN_AREA_PX) return { ok: false, error: 'degenerate' }

  const wall: Pt[] = [
    { x: 0, y: 0 },
    { x: widthCm, y: 0 },
    { x: widthCm, y: heightCm },
    { x: 0, y: heightCm },
  ]
  const h = homographyFrom4(wall, quad)
  const hInv = h && inv3(h)
  if (!h || !hInv) return { ok: false, error: 'degenerate' }

  // Denominators at the four corners: same sign (no horizon inside) and a bounded spread.
  const w = wall.map((p) => (h[6] ?? 0) * p.x + (h[7] ?? 0) * p.y + (h[8] ?? 0))
  const wMin = Math.min(...w.map(Math.abs))
  const wMax = Math.max(...w.map(Math.abs))
  if (w.some((v) => v * (w[0] ?? 1) <= 0) || wMin <= 0) return { ok: false, error: 'degenerate' }
  const scaleRatio = wMax / wMin
  if (scaleRatio > MAX_SCALE_RATIO) return { ok: false, error: 'degenerate' }

  const reprojPx = Math.max(
    ...wall.map((p, i) => {
      const q = apply3(h, p)
      const c = quad[i]
      return c ? Math.hypot(q.x - c.x, q.y - c.y) : 0
    }),
  )
  const reprojCm = reprojPx / Math.sqrt(area / (widthCm * heightCm))
  const ratio = sideScaleRatio(h, img)
  const quality: PerspectiveQuality = {
    reprojPx,
    reprojCm,
    aspectDeviation: ratio === null ? null : ratio - 1,
    impliedHeightCm: ratio === null || ratio <= 0 ? null : heightCm / ratio,
  }

  const warnings: PerspectiveWarning[] = []
  if (Math.max(widthCm, heightCm) < SHORT_REF_CM) warnings.push('short-reference')
  if (scaleRatio > WARN_SCALE_RATIO) warnings.push('strong-perspective')
  if (quality.aspectDeviation !== null && Math.abs(quality.aspectDeviation) > WARN_ASPECT) {
    warnings.push('aspect-mismatch')
  }
  if (area < WARN_AREA_FRACTION * img.w * img.h) warnings.push('small-area')

  return {
    ok: true,
    calibration: {
      mode: 'perspective',
      h,
      hInv,
      widthCm,
      heightCm,
      quad: [...quad],
      quality,
      ...(opts.wall ? { wall: true } : {}),
    },
    warnings,
  }
}
