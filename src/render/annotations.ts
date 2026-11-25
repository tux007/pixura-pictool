import { limitValue, minDistance, type RuleSettings } from '../math/clearance'
import { GUIDE_KINDS, GUIDE_SHORT, guideDistances, guideEndpoints, type Guides } from '../math/guides'
import { cornerPoint, type Box, type Corner } from '../math/motif'
import { formatNumber } from '../math/units'
import type { Pt, Size } from '../math/view'
import type { Calibration } from '../model/types'

const GUIDE = '#22d3ee'
const DIM = '#ffd166'
const NEGATIVE = '#ff8a80'
const FORBIDDEN = 'rgba(220, 38, 38, 0.22)'
const LIMIT = '#ff6b6b'

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
  // wallPen distances: when enabled, the forbidden strips next to each guide line are shaded
  rules?: RuleSettings
}

export const fmtCm = (cm: number): string => `${formatNumber(cm, Math.abs(cm) >= 20 ? 0 : 1)} cm`

// Minimum distances are whole numbers in the data sheet; keep them without decimals.
export const fmtMin = (cm: number): string => (Number.isInteger(cm) ? `${cm} cm` : fmtCm(cm))

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const hit = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

function label(ctx: CanvasRenderingContext2D, text: string, p: Pt, u: number, color = '#fff', taken?: Rect[]): Rect {
  ctx.font = `600 ${13 * u}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4 * u
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.strokeText(text, p.x, p.y)
  ctx.fillStyle = color
  ctx.fillText(text, p.x, p.y)
  const w = ctx.measureText(text).width + 6 * u
  const r = { x: p.x - w / 2, y: p.y - 9 * u, w, h: 18 * u }
  taken?.push(r)
  return r
}

// Rect a label of this text would occupy at p (same font as label()).
function extent(ctx: CanvasRenderingContext2D, text: string, p: Pt, u: number): Rect {
  ctx.font = `600 ${13 * u}px system-ui, sans-serif`
  const w = ctx.measureText(text).width + 6 * u
  return { x: p.x - w / 2, y: p.y - 9 * u, w, h: 18 * u }
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

const along = (a: Pt, b: Pt, t: number, ox = 0, oy = 0): Pt => ({
  x: a.x + (b.x - a.x) * t + ox,
  y: a.y + (b.y - a.y) * t + oy,
})

export function drawAnnotations(a: Annotations): void {
  const { ctx, map, unit: u, cal, img, box, guides } = a
  ctx.save()
  ctx.lineCap = 'round'
  const taken: Rect[] = []
  const pending: { text: string; a: Pt; b: Pt }[] = []

  // forbidden strip between each guide line and its minimum-distance line
  if (a.rules?.enabled) {
    for (const kind of GUIDE_KINDS) {
      const v = guides[kind]
      if (v === undefined) continue
      const edge = guideEndpoints(cal, img, kind, v).map(map) as [Pt, Pt]
      const lim = guideEndpoints(cal, img, kind, limitValue(kind, v, a.rules)).map(map) as [Pt, Pt]
      if (![...edge, ...lim].every(finite)) continue
      ctx.beginPath()
      ctx.moveTo(edge[0].x, edge[0].y)
      ctx.lineTo(edge[1].x, edge[1].y)
      ctx.lineTo(lim[1].x, lim[1].y)
      ctx.lineTo(lim[0].x, lim[0].y)
      ctx.closePath()
      ctx.fillStyle = FORBIDDEN
      ctx.fill()
      stroke(ctx, lim[0], lim[1], u, LIMIT, true)
      pending.push({
        text: `min. ${fmtMin(minDistance(kind, a.rules))}`,
        // middle of the forbidden strip: clear of both lines, even when the motif touches the limit
        a: along(edge[0], lim[0], 0.5),
        b: along(edge[1], lim[1], 0.5),
      })
    }
  }

  for (const kind of GUIDE_KINDS) {
    const v = guides[kind]
    if (v === undefined) continue
    const [p, q] = guideEndpoints(cal, img, kind, v).map(map) as [Pt, Pt]
    if (!finite(p) || !finite(q)) continue
    stroke(ctx, p, q, u, GUIDE, true)
    label(ctx, GUIDE_SHORT[kind], { x: p.x + (q.x - p.x) * 0.08, y: p.y + (q.y - p.y) * 0.08 }, u, '#a5f3fc', taken)
  }

  const SPOTS = [0.5, 0.3, 0.7, 0.15, 0.85]
  // first spot along a line where the text covers no other label and no distance line
  const place = (text: string, at: (t: number) => Pt, color: string, own = -1): void => {
    const clear = (t: number): boolean => {
      const r = extent(ctx, text, at(t), u)
      return !taken.some((o) => hit(r, o)) && !lines.some((l, i) => i !== own && hit(r, l))
    }
    label(ctx, text, at(SPOTS.find(clear) ?? 0.5), u, color, taken)
  }
  const lines: Rect[] = []

  if (box && a.showDims) {
    const c = map({ x: box.x, y: box.y })
    const dists: { p: Pt; q: Pt; cm: number }[] = []
    for (const d of guideDistances(box, guides)) {
      const p = map(d.from)
      const q = map(d.to)
      if (!finite(p) || !finite(q)) continue
      dists.push({ p, q, cm: d.cm })
      const m = 5 * u
      lines.push({
        x: Math.min(p.x, q.x) - m,
        y: Math.min(p.y, q.y) - m,
        w: Math.abs(p.x - q.x) + 2 * m,
        h: Math.abs(p.y - q.y) + 2 * m,
      })
    }
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
      place(text, (t) => along(oa, ob, t, dx * 12 * u, dy * 12 * u), '#fff')
    }
    side('sw', 'se', fmtCm(box.w))
    side('se', 'ne', fmtCm(box.h))

    dists.forEach((d, i) => {
      const color = d.cm < 0 ? NEGATIVE : DIM
      dimension(ctx, d.p, d.q, u, color)
      const vertical = Math.abs(d.q.y - d.p.y) >= Math.abs(d.q.x - d.p.x)
      place(
        fmtCm(d.cm),
        (t) => along(d.p, d.q, t, vertical ? 34 * u : 0, vertical ? 0 : -12 * u),
        d.cm < 0 ? NEGATIVE : '#fff',
        i,
      )
    })
  }

  // minimum-distance labels go last and slide along their line until nothing is covered
  for (const m of pending) {
    const spots = [0.5, 0.3, 0.7, 0.18, 0.82, 0.1, 0.9]
    const at = (t: number): Pt => ({
      x: m.a.x + (m.b.x - m.a.x) * t,
      y: m.a.y + (m.b.y - m.a.y) * t,
    })
    const clear = (t: number): boolean => {
      const r = extent(ctx, m.text, at(t), u)
      return !taken.some((o) => hit(r, o)) && !lines.some((o) => hit(r, o))
    }
    const free = spots.find(clear) ?? 0.5
    label(ctx, m.text, at(free), u, '#ffd0d0', taken)
  }
  ctx.restore()
}
