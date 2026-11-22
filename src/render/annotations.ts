import { GUIDE_KINDS, GUIDE_SHORT, guideDistances, guideEndpoints, type Guides } from '../math/guides'
import { cornerPoint, type Box, type Corner } from '../math/motif'
import { formatNumber } from '../math/units'
import type { Pt, Size } from '../math/view'
import type { Calibration } from '../model/types'

const GUIDE = '#22d3ee'
const DIM = '#ffd166'
const NEGATIVE = '#ff8a80'

export interface Annotations {
  ctx: CanvasRenderingContext2D
  // wall cm -> target pixels (screen CSS px live, output px for exports)
  map: (wall: Pt) => Pt
  // sizing factor for strokes and text: 1 on screen, larger for big exports
  unit: number
  cal: Calibration
  img: Size
  box: Box | null
  guides: Guides
  showDims: boolean
}

export const fmtCm = (cm: number): string => `${formatNumber(cm, Math.abs(cm) >= 20 ? 0 : 1)} cm`

function label(ctx: CanvasRenderingContext2D, text: string, p: Pt, u: number, color = '#fff'): void {
  ctx.font = `600 ${13 * u}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4 * u
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.strokeText(text, p.x, p.y)
  ctx.fillStyle = color
  ctx.fillText(text, p.x, p.y)
}

function stroke(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, u: number, color: string, dashed = false): void {
  ctx.setLineDash(dashed ? [10 * u, 6 * u] : [])
  for (const [w, c] of [
    [4 * u, 'rgba(0,0,0,0.55)'],
    [2 * u, color],
  ] as const) {
    ctx.lineWidth = w
    ctx.strokeStyle = c
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.setLineDash([])
}

// Dimension line with a small tick at each end.
function dimension(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, u: number, color: string): void {
  stroke(ctx, a, b, u, color)
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const n = { x: (-(b.y - a.y) / len) * 6 * u, y: ((b.x - a.x) / len) * 6 * u }
  for (const p of [a, b]) stroke(ctx, { x: p.x - n.x, y: p.y - n.y }, { x: p.x + n.x, y: p.y + n.y }, u, color)
}

const finite = (p: Pt): boolean => Number.isFinite(p.x) && Number.isFinite(p.y)

export function drawAnnotations(a: Annotations): void {
  const { ctx, map, unit: u, cal, img, box, guides } = a
  ctx.save()
  ctx.lineCap = 'round'

  for (const kind of GUIDE_KINDS) {
    const v = guides[kind]
    if (v === undefined) continue
    const [p, q] = guideEndpoints(cal, img, kind, v).map(map) as [Pt, Pt]
    if (!finite(p) || !finite(q)) continue
    stroke(ctx, p, q, u, GUIDE, true)
    label(ctx, GUIDE_SHORT[kind], { x: p.x + (q.x - p.x) * 0.08, y: p.y + (q.y - p.y) * 0.08 }, u, '#a5f3fc')
  }

  if (box && a.showDims) {
    const c = map({ x: box.x, y: box.y })
    const side = (c1: Corner, c2: Corner, text: string): void => {
      const pa = map(cornerPoint(box, c1))
      const pb = map(cornerPoint(box, c2))
      let dx = (pa.x + pb.x) / 2 - c.x
      let dy = (pa.y + pb.y) / 2 - c.y
      const l = Math.hypot(dx, dy) || 1
      dx /= l
      dy /= l
      const o = 18 * u
      const oa = { x: pa.x + dx * o, y: pa.y + dy * o }
      const ob = { x: pb.x + dx * o, y: pb.y + dy * o }
      if (!finite(oa) || !finite(ob)) return
      dimension(ctx, oa, ob, u, DIM)
      label(ctx, text, { x: (oa.x + ob.x) / 2 + dx * 12 * u, y: (oa.y + ob.y) / 2 + dy * 12 * u }, u)
    }
    side('sw', 'se', fmtCm(box.w))
    side('se', 'ne', fmtCm(box.h))

    for (const d of guideDistances(box, guides)) {
      const p = map(d.from)
      const q = map(d.to)
      if (!finite(p) || !finite(q)) continue
      const color = d.cm < 0 ? NEGATIVE : DIM
      dimension(ctx, p, q, u, color)
      const vertical = Math.abs(q.y - p.y) >= Math.abs(q.x - p.x)
      const at = { x: (p.x + q.x) / 2 + (vertical ? 24 * u : 0), y: (p.y + q.y) / 2 + (vertical ? 0 : -12 * u) }
      label(ctx, fmtCm(d.cm), at, u, d.cm < 0 ? NEGATIVE : '#fff')
    }
  }
  ctx.restore()
}
