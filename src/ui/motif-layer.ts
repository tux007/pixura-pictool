import { imageToWall, wallToImage } from '../math/calibration'
import {
  angleFromPointer,
  contains,
  CORNERS,
  cornerPoint,
  moveBy,
  resizeFromCorner,
  toWall,
  type Corner,
} from '../math/motif'
import { toScreen, type Pt, type View } from '../math/view'
import type { Motif, Wall } from '../model/types'
import type { Layer } from './layer'
import type { Viewport } from './viewport'

const HIT = 24
const ROT_DIST = 38
const ORANGE = '#fca311'

type Drag =
  | { kind: 'move'; last: Pt }
  | { kind: 'rotate' }
  | { kind: 'corner'; corner: Corner; grab: Pt }

export class MotifLayer implements Layer {
  wall: Wall | null = null
  motif: Motif | null = null
  enabled = true
  private drag: Drag | null = null

  constructor(
    private vp: Viewport,
    private onChange: () => void,
  ) {}

  private screen(view: View, wall: Pt): Pt {
    const cal = this.wall?.calibration
    return cal ? toScreen(view, wallToImage(cal, wall)) : { x: 0, y: 0 }
  }

  private rotateHandle(view: View): Pt | null {
    const cal = this.wall?.calibration
    const m = this.motif
    if (!cal || !m) return null
    const s = cal.pxPerCm * view.scale
    return this.screen(view, toWall(m.box, { x: 0, y: -(m.box.h / 2 + ROT_DIST / s) }))
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    const cal = this.wall?.calibration
    const m = this.motif
    if (!cal || !m) return
    const s = cal.pxPerCm * view.scale
    const { box } = m
    const c = this.screen(view, box)

    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.rotate((box.rot * Math.PI) / 180)
    ctx.globalAlpha = m.opacity / 100
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(m.image, (-box.w * s) / 2, (-box.h * s) / 2, box.w * s, box.h * s)
    ctx.restore()

    if (!this.enabled) return
    const pts = CORNERS.map((k) => this.screen(view, cornerPoint(box, k)))
    const top = this.screen(view, toWall(box, { x: 0, y: -box.h / 2 }))
    const rot = this.rotateHandle(view)
    if (!rot) return

    for (const [w, col] of [
      [4, 'rgba(0,0,0,0.5)'],
      [2, ORANGE],
    ] as const) {
      ctx.lineWidth = w
      ctx.strokeStyle = col
      ctx.beginPath()
      pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)))
      ctx.closePath()
      ctx.moveTo(top.x, top.y)
      ctx.lineTo(rot.x, rot.y)
      ctx.stroke()
    }
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = ORANGE
    ctx.lineWidth = 2
    for (const q of pts) {
      ctx.beginPath()
      ctx.rect(q.x - 8, q.y - 8, 16, 16)
      ctx.fill()
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(rot.x, rot.y, 10, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }

  down(p: Pt, view: View): boolean {
    const cal = this.wall?.calibration
    const m = this.motif
    if (!this.enabled || !cal || !m) return false
    const sp = toScreen(view, p)
    const near = (q: Pt): boolean => Math.hypot(q.x - sp.x, q.y - sp.y) < HIT
    const pw = imageToWall(cal, p)

    const rot = this.rotateHandle(view)
    if (rot && near(rot)) {
      this.drag = { kind: 'rotate' }
      return true
    }
    for (const corner of CORNERS) {
      const cp = cornerPoint(m.box, corner)
      if (near(this.screen(view, cp))) {
        this.drag = { kind: 'corner', corner, grab: { x: pw.x - cp.x, y: pw.y - cp.y } }
        return true
      }
    }
    if (contains(m.box, pw)) {
      this.drag = { kind: 'move', last: pw }
      return true
    }
    return false
  }

  move(p: Pt): void {
    const cal = this.wall?.calibration
    const m = this.motif
    const d = this.drag
    if (!cal || !m || !d) return
    const pw = imageToWall(cal, p)
    if (d.kind === 'move') {
      m.box = moveBy(m.box, pw.x - d.last.x, pw.y - d.last.y)
      d.last = pw
    } else if (d.kind === 'rotate') {
      m.box = { ...m.box, rot: angleFromPointer(m.box, pw) }
    } else {
      m.box = resizeFromCorner(m.box, d.corner, { x: pw.x - d.grab.x, y: pw.y - d.grab.y }, m.lockAspect)
    }
    this.vp.redraw()
    this.onChange()
  }

  up(): void {
    this.drag = null
  }
}
