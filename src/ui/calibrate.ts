import { calibrateLinear, MIN_POINT_PX, MIN_REF_CM } from '../math/calibration'
import { formatLength, parseLength, type Unit } from '../math/units'
import { toScreen, type Pt, type View } from '../math/view'
import type { Calibration } from '../model/types'
import { el } from './dom'
import type { Layer } from './layer'
import type { Viewport } from './viewport'

const HIT = 26
const LOUPE = 120
const ORANGE = '#fca311'

export class CalibrationFlow implements Layer {
  private pts: Pt[] = []
  private drag = -1
  private grab: Pt = { x: 0, y: 0 }
  private image: ImageBitmap | null = null
  private running = false

  private sheet = el('section', 'sheet')
  private step = el('p', 'step')
  private input = el('input')
  private unit = el('select')
  private note = el('p', 'note')
  private apply = el('button', 'btn primary', 'Übernehmen')
  private cancel = el('button', 'btn', 'Abbrechen')
  private loupe = el('div', 'loupe')
  private lcanvas = el('canvas')
  private lctx: CanvasRenderingContext2D

  constructor(
    private vp: Viewport,
    stage: HTMLElement,
    private onDone: (c: Calibration | null) => void,
  ) {
    this.sheet.setAttribute('aria-label', 'Kalibrierung')
    this.sheet.dataset.testid = 'calibration-sheet'
    this.sheet.hidden = true

    const hint = el(
      'p',
      'hint',
      'Referenz möglichst gross wählen (mindestens ca. 1 m), sonst werden Fehler auf die ganze Wand hochgerechnet. Das Foto sollte frontal aufgenommen sein.',
    )

    this.input.type = 'text'
    this.input.inputMode = 'decimal'
    this.input.autocomplete = 'off'
    this.input.placeholder = 'z. B. 2,5'
    for (const u of ['cm', 'm']) this.unit.append(new Option(u, u))
    this.unit.setAttribute('aria-label', 'Einheit')
    const label = el('label', 'field')
    label.append(el('span', undefined, 'Echte Distanz'), this.input)
    const row = el('div', 'row')
    row.append(label, this.unit)

    this.apply.type = 'button'
    this.cancel.type = 'button'
    this.note.setAttribute('role', 'status')
    const actions = el('div', 'row')
    actions.append(this.apply, this.cancel)
    this.sheet.append(this.step, hint, row, this.note, actions)

    this.lcanvas.width = LOUPE * 2
    this.lcanvas.height = LOUPE * 2
    this.loupe.hidden = true
    this.loupe.setAttribute('aria-hidden', 'true')
    this.loupe.append(this.lcanvas)
    const lctx = this.lcanvas.getContext('2d')
    if (!lctx) throw new Error('Canvas 2D is not available')
    this.lctx = lctx

    stage.append(this.loupe, this.sheet)

    this.input.addEventListener('input', () => this.refresh())
    this.unit.addEventListener('change', () => this.refresh())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.commit()
    })
    this.apply.addEventListener('click', () => this.commit())
    this.cancel.addEventListener('click', () => this.finish(null))
  }

  get active(): boolean {
    return this.running
  }

  start(image: ImageBitmap): void {
    this.image = image
    this.pts = []
    this.drag = -1
    this.running = true
    this.input.value = ''
    this.sheet.hidden = false
    this.vp.setTapHandler((p) => this.place(p))
    this.refresh()
    this.vp.redraw()
  }

  private finish(c: Calibration | null): void {
    this.running = false
    this.sheet.hidden = true
    this.loupe.hidden = true
    this.vp.setTapHandler(null)
    this.vp.redraw()
    this.onDone(c)
  }

  private place(p: Pt): void {
    if (this.pts.length >= 2) return
    this.pts.push(p)
    this.refresh()
    this.vp.redraw()
  }

  private distance(): number | null {
    const cm = parseLength(this.input.value, this.unit.value as Unit)
    return cm !== null && cm > 0 ? cm : null
  }

  private pixelDistance(): number {
    const [a, b] = this.pts
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  }

  private refresh(): void {
    const n = this.pts.length
    this.step.textContent =
      n === 0
        ? 'Tippe den ersten Punkt der bekannten Strecke an.'
        : n === 1
          ? 'Tippe den zweiten Punkt an.'
          : 'Marker ziehen zum Feinjustieren, dann die echte Distanz eingeben.'
    this.apply.disabled = n < 2
    this.note.classList.remove('error')
    const msgs: string[] = []
    if (n === 2 && this.pixelDistance() < MIN_POINT_PX) {
      msgs.push('Die Punkte liegen sehr nah beieinander, das Ergebnis wird ungenau.')
    }
    const d = this.distance()
    if (n === 2 && d !== null && d < MIN_REF_CM) {
      msgs.push('Kurze Referenz (unter 1 m): Fehler werden auf die ganze Wand hochgerechnet.')
    }
    this.note.textContent = msgs.join(' ')
    this.vp.redraw()
  }

  private commit(): void {
    const [a, b] = this.pts
    if (!a || !b) return
    const cm = this.distance()
    if (cm === null) {
      this.fail('Bitte eine Distanz grösser als 0 eingeben (z. B. 2,5 m).')
      return
    }
    const r = calibrateLinear(a, b, cm)
    if (!r.ok) {
      this.fail('Die beiden Punkte liegen zu nah beieinander.')
      return
    }
    this.finish(r.calibration)
  }

  private fail(msg: string): void {
    this.note.textContent = msg
    this.note.classList.add('error')
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    if (!this.running) return
    const s = this.pts.map((p) => toScreen(view, p))
    const [a, b] = s
    if (a && b) {
      ctx.lineCap = 'round'
      for (const [w, c] of [
        [5, 'rgba(0,0,0,0.55)'],
        [2, ORANGE],
      ] as const) {
        ctx.lineWidth = w
        ctx.strokeStyle = c
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      const cm = this.distance()
      if (cm !== null) {
        const text = formatLength(cm)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2 - 14
        ctx.font = '600 14px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.lineWidth = 4
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.strokeText(text, mx, my)
        ctx.fillStyle = '#fff'
        ctx.fillText(text, mx, my)
      }
    }
    s.forEach((q, i) => {
      ctx.lineWidth = 3
      ctx.strokeStyle = '#fff'
      ctx.fillStyle = 'rgba(20,33,61,0.55)'
      ctx.beginPath()
      ctx.arc(q.x, q.y, 11, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = ORANGE
      ctx.beginPath()
      ctx.moveTo(q.x - 18, q.y)
      ctx.lineTo(q.x + 18, q.y)
      ctx.moveTo(q.x, q.y - 18)
      ctx.lineTo(q.x, q.y + 18)
      ctx.stroke()
      ctx.font = '700 13px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillStyle = '#fff'
      ctx.fillText(String(i + 1), q.x + 14, q.y - 12)
    })
  }

  down(p: Pt, view: View): boolean {
    if (!this.running) return false
    const sp = toScreen(view, p)
    for (let i = 0; i < this.pts.length; i++) {
      const m = this.pts[i]
      if (!m) continue
      const q = toScreen(view, m)
      if (Math.hypot(q.x - sp.x, q.y - sp.y) < HIT) {
        this.drag = i
        this.grab = { x: p.x - m.x, y: p.y - m.y }
        this.loupe.hidden = false
        this.updateLoupe(view)
        return true
      }
    }
    return false
  }

  move(p: Pt, view: View): void {
    if (this.drag < 0) return
    this.pts[this.drag] = { x: p.x - this.grab.x, y: p.y - this.grab.y }
    this.updateLoupe(view)
    this.refresh()
  }

  up(): void {
    this.drag = -1
    this.loupe.hidden = true
  }

  private updateLoupe(view: View): void {
    const m = this.pts[this.drag]
    if (!m || !this.image) return
    const k = Math.max(view.scale * 3, 1.5)
    const half = LOUPE / 2 / k
    const size = this.lcanvas.width
    const c = this.lctx
    c.clearRect(0, 0, size, size)
    c.fillStyle = '#222'
    c.fillRect(0, 0, size, size)
    c.imageSmoothingEnabled = k < 4
    c.drawImage(this.image, m.x - half, m.y - half, half * 2, half * 2, 0, 0, size, size)
    c.strokeStyle = ORANGE
    c.lineWidth = 2
    c.beginPath()
    c.moveTo(size / 2, size / 2 - 40)
    c.lineTo(size / 2, size / 2 + 40)
    c.moveTo(size / 2 - 40, size / 2)
    c.lineTo(size / 2 + 40, size / 2)
    c.stroke()
    const sx = toScreen(view, m).x
    this.loupe.classList.toggle('right', sx < this.vp.getSize().w / 2)
  }
}
