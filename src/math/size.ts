import type { Size } from './view'

// Scales down so the longer edge is at most `max`; never scales up.
export function fitWithin(w: number, h: number, max: number): Size {
  const longest = Math.max(w, h)
  if (!(w > 0 && h > 0) || longest <= max) return { w, h }
  const s = max / longest
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}
