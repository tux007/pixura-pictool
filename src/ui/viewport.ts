import {
  fitView,
  keepVisible,
  panBy,
  pinchView,
  zoomAt,
  toImage,
  zoomLimits,
  type Pt,
  type Size,
  type View,
} from '../math/view'
import type { Layer } from './layer'

const TAP_MS = 300
const TAP_SLOP = 10
const DOUBLE_TAP_DIST = 30

interface Pinch {
  start: View
  ids: [number, number]
  p0: [Pt, Pt]
}

export class Viewport {
  private ctx: CanvasRenderingContext2D
  private img: ImageBitmap | null = null
  private view: View = { scale: 1, tx: 0, ty: 0 }
  private fitted = true
  private dpr = 1
  private size: Size = { w: 0, h: 0 }
  private pointers = new Map<number, Pt>()
  private travel = new Map<number, number>()
  private pinch: Pinch | null = null
  private lastTap = { t: 0, x: 0, y: 0 }
  private downAt = 0
  private raf = 0
  private layers: Layer[] = []
  private active: Layer | null = null
  private claimed = false
  private tapHandler: ((p: Pt) => void) | null = null

  addLayer(layer: Layer): void {
    this.layers.push(layer)
  }

  setTapHandler(fn: ((p: Pt) => void) | null): void {
    this.tapHandler = fn
  }

  redraw(): void {
    this.invalidate()
  }

  getView(): View {
    return this.view
  }

  getSize(): Size {
    return this.size
  }

  // Image point under the middle of the visible area.
  centerImagePoint(): Pt {
    return toImage(this.view, { x: this.size.w / 2, y: this.size.h / 2 })
  }

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D is not available')
    this.ctx = ctx
    canvas.addEventListener('pointerdown', this.onDown)
    canvas.addEventListener('pointermove', this.onMove)
    canvas.addEventListener('pointerup', this.onUp)
    canvas.addEventListener('pointercancel', this.onUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    new ResizeObserver(() => this.resize()).observe(canvas)
    this.resize()
  }

  setImage(img: ImageBitmap): void {
    this.img = img
    this.canvas.dataset.ready = 'true'
    this.fit()
  }

  fit(): void {
    if (!this.img) return
    this.view = fitView(this.imgSize(), this.size)
    this.fitted = true
    this.invalidate()
  }

  private imgSize(): Size {
    return this.img ? { w: this.img.width, h: this.img.height } : { w: 0, h: 0 }
  }

  private resize(): void {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    this.dpr = window.devicePixelRatio || 1
    this.canvas.width = Math.max(1, Math.round(w * this.dpr))
    this.canvas.height = Math.max(1, Math.round(h * this.dpr))
    this.size = { w, h }
    if (this.img && this.fitted) this.view = fitView(this.imgSize(), this.size)
    this.invalidate()
  }

  private invalidate(): void {
    if (this.raf) return
    this.raf = requestAnimationFrame(() => {
      this.raf = 0
      this.render()
    })
  }

  private render(): void {
    const { ctx, view, dpr, canvas } = this
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!this.img) return
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this.img, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    for (const layer of this.layers) layer.draw(ctx, view)
    canvas.dataset.scale = view.scale.toFixed(4)
    canvas.dataset.tx = view.tx.toFixed(1)
    canvas.dataset.ty = view.ty.toFixed(1)
  }

  private apply(v: View): void {
    this.view = keepVisible(v, this.imgSize(), this.size)
    this.fitted = false
    this.invalidate()
  }

  private local(e: MouseEvent): Pt {
    const r = this.canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private startPinch(): void {
    if (this.pointers.size !== 2) {
      this.pinch = null
      return
    }
    const [a, b] = [...this.pointers.entries()]
    if (!a || !b) return
    this.pinch = { start: this.view, ids: [a[0], b[0]], p0: [a[1], b[1]] }
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.img) return
    this.canvas.setPointerCapture(e.pointerId)
    this.pointers.set(e.pointerId, this.local(e))
    this.travel.set(e.pointerId, 0)
    this.downAt = performance.now()
    if (this.pointers.size === 1) {
      this.claimed = false
      const p = toImage(this.view, this.local(e))
      for (const layer of [...this.layers].reverse()) {
        if (layer.down(p, this.view)) {
          this.active = layer
          this.claimed = true
          break
        }
      }
    } else if (this.active) {
      this.active.up()
      this.active = null
    }
    this.startPinch()
  }

  private onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId)
    if (!prev || !this.img) return
    const cur = this.local(e)
    this.pointers.set(e.pointerId, cur)
    this.travel.set(e.pointerId, (this.travel.get(e.pointerId) ?? 0) + Math.hypot(cur.x - prev.x, cur.y - prev.y))

    if (this.active && this.pointers.size === 1) {
      this.active.move(toImage(this.view, cur), this.view)
    } else if (this.pointers.size === 1) {
      this.apply(panBy(this.view, cur.x - prev.x, cur.y - prev.y))
    } else if (this.pinch) {
      const a1 = this.pointers.get(this.pinch.ids[0])
      const b1 = this.pointers.get(this.pinch.ids[1])
      if (!a1 || !b1) return
      const [a0, b0] = this.pinch.p0
      this.apply(pinchView(this.pinch.start, a0, b0, a1, b1, zoomLimits(this.imgSize(), this.size)))
    }
  }

  private onUp = (e: PointerEvent): void => {
    const pos = this.pointers.get(e.pointerId)
    if (!pos) return
    const now = performance.now()
    if (this.active) {
      this.active.up()
      this.active = null
    }
    const wasTap =
      !this.claimed &&
      this.pointers.size === 1 &&
      e.type === 'pointerup' &&
      (this.travel.get(e.pointerId) ?? 0) < TAP_SLOP &&
      now - this.downAt < TAP_MS
    if (wasTap && this.tapHandler) {
      this.tapHandler(toImage(this.view, pos))
    } else if (wasTap) {
      const near = Math.hypot(pos.x - this.lastTap.x, pos.y - this.lastTap.y) < DOUBLE_TAP_DIST
      if (now - this.lastTap.t < TAP_MS && near) {
        this.fit()
        this.lastTap.t = 0
      } else {
        this.lastTap = { t: now, x: pos.x, y: pos.y }
      }
    }
    this.pointers.delete(e.pointerId)
    this.travel.delete(e.pointerId)
    this.startPinch()
  }

  private onWheel = (e: WheelEvent): void => {
    if (!this.img) return
    e.preventDefault()
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015))
    this.apply(zoomAt(this.view, this.local(e), factor, zoomLimits(this.imgSize(), this.size)))
  }
}
