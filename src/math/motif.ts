import type { Pt } from './view'

// Centre position and size in wall centimetres, rotation in degrees (clockwise).
export interface Box {
  x: number
  y: number
  w: number
  h: number
  rot: number
}

export type Corner = 'nw' | 'ne' | 'se' | 'sw'

export const CORNERS: readonly Corner[] = ['nw', 'ne', 'se', 'sw']
export const MIN_SIZE = 1
export const MAX_SIZE = 10000

const SIGN: Record<Corner, readonly [number, number]> = {
  nw: [-1, -1],
  ne: [1, -1],
  se: [1, 1],
  sw: [-1, 1],
}

const RAD = Math.PI / 180
const clampSize = (v: number): number => Math.min(MAX_SIZE, Math.max(MIN_SIZE, v))

export function normalizeAngle(deg: number): number {
  const r = ((((deg + 180) % 360) + 360) % 360) - 180
  return r === -180 ? 180 : r
}

function rotate(p: Pt, deg: number): Pt {
  const c = Math.cos(deg * RAD)
  const s = Math.sin(deg * RAD)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

export function toLocal(b: Box, p: Pt): Pt {
  return rotate({ x: p.x - b.x, y: p.y - b.y }, -b.rot)
}

export function toWall(b: Box, local: Pt): Pt {
  const r = rotate(local, b.rot)
  return { x: b.x + r.x, y: b.y + r.y }
}

export function cornerPoint(b: Box, c: Corner): Pt {
  const [sx, sy] = SIGN[c]
  return toWall(b, { x: (sx * b.w) / 2, y: (sy * b.h) / 2 })
}

export function contains(b: Box, p: Pt): boolean {
  const l = toLocal(b, p)
  return Math.abs(l.x) <= b.w / 2 && Math.abs(l.y) <= b.h / 2
}

export function moveBy(b: Box, dx: number, dy: number): Box {
  return { ...b, x: b.x + dx, y: b.y + dy }
}

export function setWidth(b: Box, w: number, aspect: number, lock: boolean): Box {
  const nw = clampSize(w)
  return { ...b, w: nw, h: lock ? clampSize(nw / aspect) : b.h }
}

export function setHeight(b: Box, h: number, aspect: number, lock: boolean): Box {
  const nh = clampSize(h)
  return { ...b, h: nh, w: lock ? clampSize(nh * aspect) : b.w }
}

// Drags one corner to `pointer` while the opposite corner stays fixed, also when rotated.
export function resizeFromCorner(b: Box, corner: Corner, pointer: Pt, lock: boolean): Box {
  const [sx, sy] = SIGN[corner]
  const opp = { x: (-sx * b.w) / 2, y: (-sy * b.h) / 2 }
  const p = toLocal(b, pointer)
  const dx = (p.x - opp.x) * sx
  const dy = (p.y - opp.y) * sy

  let nw: number
  let nh: number
  if (lock) {
    const s = (dx * b.w + dy * b.h) / (b.w * b.w + b.h * b.h)
    const lo = Math.max(MIN_SIZE / b.w, MIN_SIZE / b.h)
    const hi = Math.min(MAX_SIZE / b.w, MAX_SIZE / b.h)
    const k = Math.min(hi, Math.max(lo, s))
    nw = b.w * k
    nh = b.h * k
  } else {
    nw = clampSize(dx)
    nh = clampSize(dy)
  }
  const c = toWall(b, { x: opp.x + (sx * nw) / 2, y: opp.y + (sy * nh) / 2 })
  return { ...b, x: c.x, y: c.y, w: nw, h: nh }
}

// Rotation handle sits above the top edge; the angle follows the pointer and snaps to `step`.
export function angleFromPointer(b: Box, pointer: Pt, step = 15, tol = 3): number {
  const dx = pointer.x - b.x
  const dy = pointer.y - b.y
  if (dx === 0 && dy === 0) return b.rot
  const deg = Math.atan2(dx, -dy) / RAD
  const snapped = Math.round(deg / step) * step
  return normalizeAngle(Math.abs(deg - snapped) <= tol ? snapped : deg)
}
