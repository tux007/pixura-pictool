import type { Calibration } from '../model/types'
import { wallW } from './calibration'
import { CORNERS, cornerPoint, type Box } from './motif'
import type { Pt, Size } from './view'

export type GuideKind = 'floor' | 'ceiling' | 'left' | 'right'
// Wall coordinate (cm) of each line: y for floor/ceiling, x for the wall edges.
export type Guides = Partial<Record<GuideKind, number>>

export const GUIDE_KINDS: readonly GuideKind[] = ['floor', 'ceiling', 'left', 'right']

export const GUIDE_LABEL: Record<GuideKind, string> = {
  floor: 'Boden',
  ceiling: 'Decke',
  left: 'Linke Wandkante',
  right: 'Rechte Wandkante',
}

export const GUIDE_SHORT: Record<GuideKind, string> = {
  floor: 'Boden',
  ceiling: 'Decke',
  left: 'Links',
  right: 'Rechts',
}

export const isHorizontal = (k: GuideKind): boolean => k === 'floor' || k === 'ceiling'

export const guideValueAt = (k: GuideKind, p: Pt): number => (isHorizontal(k) ? p.y : p.x)

export interface Distance {
  kind: GuideKind
  // Gap between the motif's extreme edge and the line; negative if the motif crosses it.
  cm: number
  from: Pt
  to: Pt
}

const EPS = 1e-6
const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

// Axis-aligned bounding box of the (rotated) motif in wall coordinates.
export function boxBounds(box: Box): Bounds {
  const pts = CORNERS.map((c) => cornerPoint(box, c))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

// Distances from the rotated motif's bounding box to each set line, plus the segment to draw.
export function guideDistances(box: Box, guides: Guides): Distance[] {
  const pts = CORNERS.map((c) => cornerPoint(box, c))
  const { minX, maxX, minY, maxY } = boxBounds(box)
  const xAtY = (y: number): number => mean(pts.filter((p) => Math.abs(p.y - y) < EPS).map((p) => p.x))
  const yAtX = (x: number): number => mean(pts.filter((p) => Math.abs(p.x - x) < EPS).map((p) => p.y))

  const out: Distance[] = []
  const { floor, ceiling, left, right } = guides
  if (floor !== undefined) {
    const x = xAtY(maxY)
    out.push({ kind: 'floor', cm: floor - maxY, from: { x, y: maxY }, to: { x, y: floor } })
  }
  if (ceiling !== undefined) {
    const x = xAtY(minY)
    out.push({ kind: 'ceiling', cm: minY - ceiling, from: { x, y: minY }, to: { x, y: ceiling } })
  }
  if (left !== undefined) {
    const y = yAtX(minX)
    out.push({ kind: 'left', cm: minX - left, from: { x: minX, y }, to: { x: left, y } })
  }
  if (right !== undefined) {
    const y = yAtX(maxX)
    out.push({ kind: 'right', cm: right - maxX, from: { x: maxX, y }, to: { x: right, y } })
  }
  return out
}

// A calibration on the whole wall already knows where ceiling, floor and both inner corners are:
// the rectangle's edges, in wall coordinates (origin top-left, y down).
export function guidesFromWall(cal: Calibration): Guides {
  if (cal.mode !== 'perspective' || !cal.wall) return {}
  return { ceiling: 0, floor: cal.heightCm, left: 0, right: cal.widthCm }
}

// Two wall points that span the photo along the line, so it can be drawn edge to edge.
export function guideEndpoints(cal: Calibration, img: Size, kind: GuideKind, v: number): [Pt, Pt] {
  const horiz = isHorizontal(kind)
  const at = (t: number): Pt => (horiz ? { x: t, y: v } : { x: v, y: t })
  if (cal.mode === 'linear') {
    const ext = (horiz ? img.w : img.h) / cal.pxPerCm
    return [at(0), at(ext)]
  }
  const ext = horiz ? cal.widthCm : cal.heightCm
  const ref = wallW(cal, { x: cal.widthCm / 2, y: cal.heightCm / 2 })
  const wide: [Pt, Pt] = [at(-0.5 * ext), at(1.5 * ext)]
  // Stay in front of the camera: far ends may cross the horizon in a strong perspective.
  return wide.every((p) => wallW(cal, p) / ref > 0.2) ? wide : [at(0), at(ext)]
}
