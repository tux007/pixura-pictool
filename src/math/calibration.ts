import type { Calibration } from '../model/types'
import type { Pt } from './view'

export const MIN_REF_CM = 100
export const MIN_POINT_PX = 50

export type CalibrationError = 'points-too-close' | 'bad-distance'
export type CalibrationWarning = 'short-reference' | 'close-points'

export type CalibrationResult =
  | { ok: true; calibration: Calibration; warnings: CalibrationWarning[] }
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

// Wall coordinates are centimetres with the origin at the photo's top-left corner.
export const wallToImage = (c: Calibration, p: Pt): Pt => ({ x: p.x * c.pxPerCm, y: p.y * c.pxPerCm })

export const imageToWall = (c: Calibration, p: Pt): Pt => ({ x: p.x / c.pxPerCm, y: p.y / c.pxPerCm })
