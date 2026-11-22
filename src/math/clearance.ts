import { boxBounds, type GuideKind, type Guides } from './guides'
import { MAX_SIZE, MIN_SIZE, type Box } from './motif'

// wallPen printer requirements ("Wandabstände"), all in cm. The sides map onto the guide lines:
// floor, ceiling and the two inner corners.
export const WALLPEN = {
  ceiling: 40,
  corner: 10,
  floor: 25,
  floorWithRail: 30,
} as const

export interface RuleSettings {
  // check the motif against the wallPen distances
  enabled: boolean
  // printing with the guide rail: 30 cm instead of 25 cm to the floor
  rail: boolean
  // skirting board height; the floor distance is measured from its top edge (0 = none)
  skirtingCm: number
}

export const DEFAULT_RULES: RuleSettings = { enabled: true, rail: false, skirtingCm: 0 }

// Float noise and sub-millimetre differences are not violations.
export const TOLERANCE_CM = 0.05

// Minimum gap between the motif and a guide line.
export function minDistance(kind: GuideKind, s: RuleSettings): number {
  switch (kind) {
    case 'ceiling':
      return WALLPEN.ceiling
    case 'floor':
      return Math.max(0, s.skirtingCm) + (s.rail ? WALLPEN.floorWithRail : WALLPEN.floor)
    default:
      return WALLPEN.corner
  }
}

// Wall coordinate of the limit line that belongs to a guide line (y grows downwards).
export function limitValue(kind: GuideKind, guide: number, s: RuleSettings): number {
  const m = minDistance(kind, s)
  return kind === 'ceiling' || kind === 'left' ? guide + m : guide - m
}

export type Side = 'top' | 'bottom' | 'left' | 'right'

export const SIDE_OF: Record<GuideKind, Side> = { ceiling: 'top', floor: 'bottom', left: 'left', right: 'right' }
export const SIDE_LABEL: Record<Side, string> = {
  top: 'Decke',
  bottom: 'Boden',
  left: 'Linke Innenecke',
  right: 'Rechte Innenecke',
}

// Edges of the area where the motif may be printed; a side is missing until its guide is set.
export interface Limits {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

export function printLimits(g: Guides, s: RuleSettings): Limits {
  const out: Limits = {}
  if (g.ceiling !== undefined) out.top = limitValue('ceiling', g.ceiling, s)
  if (g.floor !== undefined) out.bottom = limitValue('floor', g.floor, s)
  if (g.left !== undefined) out.left = limitValue('left', g.left, s)
  if (g.right !== undefined) out.right = limitValue('right', g.right, s)
  return out
}

export interface Reserve {
  side: Side
  // room left between the motif's bounding box and the limit; negative = too close
  cm: number
}

export function reserves(box: Box, l: Limits): Reserve[] {
  const b = boxBounds(box)
  const out: Reserve[] = []
  if (l.top !== undefined) out.push({ side: 'top', cm: b.minY - l.top })
  if (l.bottom !== undefined) out.push({ side: 'bottom', cm: l.bottom - b.maxY })
  if (l.left !== undefined) out.push({ side: 'left', cm: b.minX - l.left })
  if (l.right !== undefined) out.push({ side: 'right', cm: l.right - b.maxX })
  return out
}

export interface RuleCheck {
  state: 'off' | 'unchecked' | 'ok' | 'violated'
  violated: Reserve[]
  // sides that could not be checked because their guide line is not set
  missing: Side[]
}

export function checkRules(box: Box, guides: Guides, s: RuleSettings): RuleCheck {
  if (!s.enabled) return { state: 'off', violated: [], missing: [] }
  const r = reserves(box, printLimits(guides, s))
  const all: Side[] = ['top', 'bottom', 'left', 'right']
  const missing = all.filter((side) => !r.some((x) => x.side === side))
  const violated = r.filter((x) => x.cm < -TOLERANCE_CM)
  const state = !r.length ? 'unchecked' : violated.length ? 'violated' : 'ok'
  return { state, violated, missing }
}

// Largest factor by which the motif can be scaled around its own centre and still respect every
// limit that is set (rotation and shape stay as they are). Null when no limit is set at all.
export function maxScaleAtCenter(box: Box, l: Limits): number | null {
  const r = (box.rot * Math.PI) / 180
  const ex = (box.w * Math.abs(Math.cos(r)) + box.h * Math.abs(Math.sin(r))) / 2
  const ey = (box.w * Math.abs(Math.sin(r)) + box.h * Math.abs(Math.cos(r))) / 2
  const caps: number[] = []
  if (l.left !== undefined) caps.push((box.x - l.left) / ex)
  if (l.right !== undefined) caps.push((l.right - box.x) / ex)
  if (l.top !== undefined) caps.push((box.y - l.top) / ey)
  if (l.bottom !== undefined) caps.push((l.bottom - box.y) / ey)
  return caps.length ? Math.max(0, Math.min(...caps)) : null
}

// Scales the motif about its centre, keeping its shape inside the global size limits.
export function scaleBox(box: Box, k: number): Box {
  const lo = Math.max(MIN_SIZE / box.w, MIN_SIZE / box.h)
  const hi = Math.min(MAX_SIZE / box.w, MAX_SIZE / box.h)
  const f = Math.min(hi, Math.max(lo, k))
  return { ...box, w: box.w * f, h: box.h * f }
}

// The biggest copy of the motif (same shape and rotation) that fills the printable area, centred.
// Needs all four limits; null if any is missing or the area is empty.
export function fitToArea(box: Box, l: Limits): Box | null {
  const { top, bottom, left, right } = l
  if (top === undefined || bottom === undefined || left === undefined || right === undefined) return null
  const aw = right - left
  const ah = bottom - top
  if (!(aw > 0 && ah > 0)) return null
  const r = (box.rot * Math.PI) / 180
  const ex = (box.w * Math.abs(Math.cos(r)) + box.h * Math.abs(Math.sin(r))) / 2
  const ey = (box.w * Math.abs(Math.sin(r)) + box.h * Math.abs(Math.cos(r))) / 2
  const k = Math.min(aw / (2 * ex), ah / (2 * ey))
  return { ...scaleBox(box, k), x: (left + right) / 2, y: (top + bottom) / 2 }
}

const cm = (v: number): string => `${Math.round(v * 10) / 10}`.replace('.', ',')

// Plain-text summary for the UI and the exports.
export function describeCheck(c: RuleCheck, s: RuleSettings): string {
  switch (c.state) {
    case 'off':
      return ''
    case 'unchecked':
      return 'Hilfslinien setzen, um die wallPen-Mindestabstände zu prüfen.'
    case 'violated':
      return `Mindestabstand unterschritten: ${c.violated.map((v) => `${SIDE_LABEL[v.side]} (${cm(v.cm)} cm)`).join(', ')}.`
    case 'ok': {
      const rest = c.missing.length ? ` Nicht geprüft: ${c.missing.map((m) => SIDE_LABEL[m]).join(', ')}.` : ''
      return `Mindestabstände eingehalten (Decke ${WALLPEN.ceiling}, Ecken ${WALLPEN.corner}, Boden ${minDistance('floor', s)} cm).${rest}`
    }
  }
}
