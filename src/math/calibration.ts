import type { Calibration, LinearCalibration } from '../model/types'
import { apply3, IDENTITY, type Mat3 } from './homography'
import type { Pt } from './view'

export const MIN_REF_CM = 100
export const MIN_POINT_PX = 50

export type CalibrationError = 'points-too-close' | 'bad-distance'
export type CalibrationWarning = 'short-reference' | 'close-points'

export type CalibrationResult =
  | { ok: true; calibration: LinearCalibration; warnings: CalibrationWarning[] }
  | { ok: false; error: CalibrationError }

// Two-point calibration of a frontal photo: pixels per centimetre from one known distance.
export function calibrateLinear(a: Pt, b: Pt, distanceCm: number): CalibrationResult {
  if (!Number.isFinite(distanceCm) || distanceCm <= 0) return { ok: false, error: 'bad-distance' }
  const px = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(px >= 1)) return { ok: false, error: 'points-too-close' }
  const warnings: CalibrationWarning[] = []
  if (distanceCm < MIN_REF_CM) warnings.push('short-reference')
  if (px < MIN_POINT_PX) warnings.push('close-points')
  return { ok: true, calibration: { mode: 'linear', pxPerCm: px / distanceCm }, warnings }
}

// Wall coordinates are centimetres. Linear: origin at the photo's top-left corner.
// Perspective: origin at the calibration rectangle's top-left corner.
export function wallToImage(c: Calibration, p: Pt): Pt {
  return c.mode === 'linear' ? { x: p.x * c.pxPerCm, y: p.y * c.pxPerCm } : apply3(c.h, p)
}

export function imageToWall(c: Calibration, p: Pt): Pt {
  return c.mode === 'linear' ? { x: p.x / c.pxPerCm, y: p.y / c.pxPerCm } : apply3(c.hInv, p)
}

// Homogeneous denominator of the wall -> image mapping; > 0 in front of the camera, constant for linear.
export const wallW = (c: Calibration, p: Pt): number =>
  c.mode === 'linear' ? 1 : (c.h[6] ?? 0) * p.x + (c.h[7] ?? 0) * p.y + (c.h[8] ?? 0)

export function imageToWallMatrix(c: Calibration): Mat3 {
  if (c.mode === 'perspective') return c.hInv
  const k = 1 / c.pxPerCm
  return c.pxPerCm === 1 ? IDENTITY : [k, 0, 0, 0, k, 0, 0, 0, 1]
}

// Image pixels per wall centimetre around `at` (constant for linear calibration).
export function localPxPerCm(c: Calibration, at?: Pt): number {
  if (c.mode === 'linear') return c.pxPerCm
  const p = at ?? { x: c.widthCm / 2, y: c.heightCm / 2 }
  const o = wallToImage(c, p)
  const x = wallToImage(c, { x: p.x + 1, y: p.y })
  const y = wallToImage(c, { x: p.x, y: p.y + 1 })
  return (Math.hypot(x.x - o.x, x.y - o.y) + Math.hypot(y.x - o.x, y.y - o.y)) / 2
}

// A sensible default wall width in cm for sizing a new motif.
export function wallWidthCm(c: Calibration, imageWidth: number): number {
  return c.mode === 'linear' ? imageWidth / c.pxPerCm : c.widthCm
}
