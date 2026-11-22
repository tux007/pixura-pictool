export interface Pt {
  x: number
  y: number
}

export interface Size {
  w: number
  h: number
}

// screen = image * scale + (tx, ty), all in CSS pixels
export interface View {
  scale: number
  tx: number
  ty: number
}

export interface Limits {
  min: number
  max: number
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function fitScale(img: Size, vp: Size, margin = 0): number {
  const aw = vp.w - 2 * margin
  const ah = vp.h - 2 * margin
  if (img.w <= 0 || img.h <= 0 || aw <= 0 || ah <= 0) return 1
  return Math.min(aw / img.w, ah / img.h)
}

export function fitView(img: Size, vp: Size, margin = 0): View {
  const scale = fitScale(img, vp, margin)
  return { scale, tx: (vp.w - img.w * scale) / 2, ty: (vp.h - img.h * scale) / 2 }
}

export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty })

export const toImage = (v: View, p: Pt): Pt => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale })

export function zoomLimits(img: Size, vp: Size): Limits {
  const f = fitScale(img, vp)
  return { min: f / 4, max: Math.max(8, f) }
}

export function zoomAt(v: View, focus: Pt, factor: number, lim: Limits): View {
  const scale = clamp(v.scale * factor, lim.min, lim.max)
  const k = scale / v.scale
  return { scale, tx: focus.x - (focus.x - v.tx) * k, ty: focus.y - (focus.y - v.ty) * k }
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, tx: v.tx + dx, ty: v.ty + dy })

// Two-finger gesture: the image point under the start midpoint follows the new midpoint.
export function pinchView(start: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt, lim: Limits): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
  const ratio = d0 > 0 ? d1 / d0 : 1
  const scale = clamp(start.scale * ratio, lim.min, lim.max)
  const anchor = toImage(start, { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 })
  return {
    scale,
    tx: (a1.x + b1.x) / 2 - anchor.x * scale,
    ty: (a1.y + b1.y) / 2 - anchor.y * scale,
  }
}

// Keeps at least `margin` px of the image inside the viewport so it cannot be lost off-screen.
export function keepVisible(v: View, img: Size, vp: Size, margin = 80): View {
  const w = img.w * v.scale
  const h = img.h * v.scale
  const mx = Math.min(margin, w, vp.w)
  const my = Math.min(margin, h, vp.h)
  return {
    scale: v.scale,
    tx: clamp(v.tx, mx - w, vp.w - mx),
    ty: clamp(v.ty, my - h, vp.h - my),
  }
}
