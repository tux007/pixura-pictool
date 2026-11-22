import { calibrateLinear, MIN_POINT_PX, MIN_REF_CM } from '../math/calibration'
import {
  calibratePerspective,
  type PerspectiveError,
  type PerspectiveResult,
  type PerspectiveWarning,
} from '../math/perspective'
import { formatLength, formatNumber, parseLength, type Unit } from '../math/units'
import { toScreen, type Pt, type View } from '../math/view'
import type { Calibration } from '../model/types'
import { el } from './dom'
import type { Layer } from './layer'
import type { Viewport } from './viewport'

const HIT = 26
const LOUPE = 120
const ORANGE = '#fca311'
const CORNER_NAMES = ['oben links', 'oben rechts', 'unten rechts', 'unten links'] as const

type Mode = 'linear' | 'perspective'

const WARNINGS: Record<PerspectiveWarning, string> = {
  'short-reference': 'Kurze Referenz (unter 1 m): Fehler werden auf die ganze Wand hochgerechnet.',
  'strong-perspective': 'Starke Perspektive: wenn möglich frontaler fotografieren, die Fehler wachsen zum Rand hin.',
  'aspect-mismatch':
    'Das Seitenverhältnis passt laut Foto nicht zu deiner Eingabe. Stimmen Breite und Höhe, sind die Ecken richtig gesetzt?',
  'small-area': 'Das Rechteck ist klein im Foto: Fehler werden hochgerechnet.',
}

const ERRORS: Record<PerspectiveError, string> = {
  'bad-size': 'Bitte Breite und Höhe grösser als 0 eingeben (z. B. 2 m und 2,1 m).',
  degenerate: 'Die vier Punkte ergeben kein brauchbares Viereck (fast auf einer Linie, zu nah beieinander oder zu extrem).',
  'not-convex': 'Die Punkte kreuzen sich. Reihenfolge: oben links, oben rechts, unten rechts, unten links.',
  'wrong-order': 'Die Punkte liegen gegen den Uhrzeigersinn. Reihenfolge: oben links, oben rechts, unten rechts, unten links.',
}

export class CalibrationFlow implements Layer {
  private mode: Mode = 'linear'
  private pts: Pt[] = []
  private drag = -1
  private grab: Pt = { x: 0, y: 0 }
  private image: ImageBitmap | null = null
  private running = false

  private sheet = el('section', 'sheet')
  private step = el('p', 'step')
  private modeLinear = el('button', 'btn', 'Strecke (2 Punkte)')
  private modePersp = el('button', 'btn', 'Rechteck (4 Punkte)')
  private distance = el('input')
  private rectW = el('input')
  private rectH = el('input')
  private linearRow = el('div', 'row')
  private rectRow = el('div', 'row')
  private unit = el('select')
  private note = el('p', 'note')
  private quality = el('p', 'quality')
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
      'Referenz möglichst gross wählen (mindestens ca. 1 m), sonst werden Fehler auf die ganze Wand hochgerechnet. Das Foto nicht im Ultraweitwinkel aufnehmen.',
    )

    const modes = el('div', 'row')
    for (const b of [this.modeLinear, this.modePersp]) b.type = 'button'
    this.modeLinear.dataset.testid = 'mode-linear'
    this.modePersp.dataset.testid = 'mode-perspective'
    modes.append(this.modeLinear, this.modePersp)

    for (const i of [this.distance, this.rectW, this.rectH]) {
      i.type = 'text'
      i.inputMode = 'decimal'
      i.autocomplete = 'off'
    }
    this.distance.placeholder = 'z. B. 2,5'
    this.rectW.placeholder = 'z. B. 90'
    this.rectH.placeholder = 'z. B. 2,1 m'
    for (const u of ['cm', 'm']) this.unit.append(new Option(u, u))
    this.unit.setAttribute('aria-label', 'Einheit')

    const field = (label: string, input: HTMLInputElement): HTMLLabelElement => {
      const l = el('label', 'field')
      l.append(el('span', undefined, label), input)
      return l
    }
    this.linearRow.append(field('Echte Distanz', this.distance))
    this.rectRow.append(field('Rechteck-Breite', this.rectW), field('Rechteck-Höhe', this.rectH))
    const unitRow = el('div', 'row')
    unitRow.append(el('span', undefined, 'Einheit ohne Angabe:'), this.unit)

    this.apply.type = 'button'
    this.cancel.type = 'button'
    this.note.setAttribute('role', 'status')
    this.quality.dataset.testid = 'quality'
    const actions = el('div', 'row')
    actions.append(this.apply, this.cancel)
    this.sheet.append(this.step, modes, hint, this.linearRow, this.rectRow, unitRow, this.note, this.quality, actions)

    this.lcanvas.width = LOUPE * 2
    this.lcanvas.height = LOUPE * 2
    this.loupe.hidden = true
    this.loupe.setAttribute('aria-hidden', 'true')
    this.loupe.append(this.lcanvas)
    const lctx = this.lcanvas.getContext('2d')
    if (!lctx) throw new Error('Canvas 2D is not available')
    this.lctx = lctx

    stage.append(this.loupe, this.sheet)

    for (const i of [this.distance, this.rectW, this.rectH]) {
      i.addEventListener('input', () => this.refresh())
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.commit()
      })
    }
    this.unit.addEventListener('change', () => this.refresh())
    this.modeLinear.addEventListener('click', () => this.setMode('linear'))
    this.modePersp.addEventListener('click', () => this.setMode('perspective'))
    this.apply.addEventListener('click', () => this.commit())
    this.cancel.addEventListener('click', () => this.finish(null))
  }

  get active(): boolean {
    return this.running
  }

  private get target(): number {
    return this.mode === 'linear' ? 2 : 4
  }

  start(image: ImageBitmap): void {
    this.image = image
    this.running = true
    this.sheet.hidden = false
    this.distance.value = ''
    this.rectW.value = ''
    this.rectH.value = ''
    this.vp.setTapHandler((p) => this.place(p))
    this.setMode('linear')
  }

  private setMode(m: Mode): void {
    this.mode = m
    this.pts = []
    this.drag = -1
    this.linearRow.hidden = m !== 'linear'
    this.rectRow.hidden = m !== 'perspective'
    this.modeLinear.setAttribute('aria-pressed', String(m === 'linear'))
    this.modePersp.setAttribute('aria-pressed', String(m === 'perspective'))
    this.refresh()
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
    if (this.pts.length >= this.target) return
    this.pts.push(p)
    this.refresh()
  }

  private len(input: HTMLInputElement): number | null {
    const cm = parseLength(input.value, this.unit.value as Unit)
    return cm !== null && cm > 0 ? cm : null
  }

  private pixelDistance(): number {
    const [a, b] = this.pts
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  }

  private perspective(): PerspectiveResult | null {
    const [a, b, c, d] = this.pts
    const w = this.len(this.rectW)
    const h = this.len(this.rectH)
    if (!a || !b || !c || !d || w === null || h === null || !this.image) return null
    return calibratePerspective([a, b, c, d], w, h, { w: this.image.width, h: this.image.height })
  }

  private refresh(): void {
    const n = this.pts.length
    const done = n >= this.target
    if (this.mode === 'linear') {
      this.step.textContent =
        n === 0
          ? 'Tippe den ersten Punkt der bekannten Strecke an.'
          : n === 1
            ? 'Tippe den zweiten Punkt an.'
            : 'Marker ziehen zum Feinjustieren, dann die echte Distanz eingeben.'
    } else {
      this.step.textContent = done
        ? 'Marker ziehen zum Feinjustieren, dann Breite und Höhe des Rechtecks eingeben.'
        : `Tippe die Ecke „${CORNER_NAMES[n]}“ des bekannten Rechtecks an (Tür, Fenster, markierte Fläche).`
    }
    this.apply.disabled = !done
    this.note.classList.remove('error')
    this.quality.textContent = ''

    const msgs: string[] = []
    if (this.mode === 'linear') {
      if (done && this.pixelDistance() < MIN_POINT_PX) {
        msgs.push('Die Punkte liegen sehr nah beieinander, das Ergebnis wird ungenau.')
      }
      const d = this.len(this.distance)
      if (done && d !== null && d < MIN_REF_CM) msgs.push(WARNINGS['short-reference'])
    } else if (done) {
      const r = this.perspective()
      if (r?.ok) {
        for (const w of r.warnings) msgs.push(WARNINGS[w])
        const q = r.calibration.quality
        let text = `Kalibrierfehler: Rückprojektion ${formatNumber(q.reprojPx, 2)} px (${formatNumber(q.reprojCm, 2)} cm).`
        if (q.aspectDeviation !== null) {
          text += ` Seitenverhältnis weicht laut Foto um ca. ${formatNumber(Math.abs(q.aspectDeviation) * 100)} % ab`
          if (Math.abs(q.aspectDeviation) > 0.03 && q.impliedHeightCm !== null) {
            text += ` (Höhe laut Foto etwa ${formatNumber(q.impliedHeightCm)} statt ${formatNumber(r.calibration.heightCm)} cm)`
          }
          text += '.'
        }
        this.quality.textContent = text
      } else if (r) {
        msgs.push(ERRORS[r.error])
        this.note.classList.add('error')
      }
    }
    this.note.textContent = msgs.join(' ')
    this.vp.redraw()
  }

  private commit(): void {
    if (this.pts.length < this.target) return
    if (this.mode === 'linear') {
      const [a, b] = this.pts
      const cm = this.len(this.distance)
      if (!a || !b) return
      if (cm === null) return this.fail('Bitte eine Distanz grösser als 0 eingeben (z. B. 2,5 m).')
      const r = calibrateLinear(a, b, cm)
      if (!r.ok) return this.fail('Die beiden Punkte liegen zu nah beieinander.')
      this.finish(r.calibration)
      return
    }
    const r = this.perspective()
    if (!r) return this.fail(ERRORS['bad-size'])
    if (!r.ok) return this.fail(ERRORS[r.error])
    this.finish(r.calibration)
  }

  private fail(msg: string): void {
    this.note.textContent = msg
    this.note.classList.add('error')
  }

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    if (!this.running) return
    const s = this.pts.map((p) => toScreen(view, p))
    const first = s[0]
    if (first && s.length >= 2) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (const q of s.slice(1)) ctx.lineTo(q.x, q.y)
      if (s.length === 4) {
        ctx.closePath()
        ctx.fillStyle = 'rgba(252,163,17,0.14)'
        ctx.fill()
      }
      for (const [w, c] of [
        [5, 'rgba(0,0,0,0.55)'],
        [2, ORANGE],
      ] as const) {
        ctx.lineWidth = w
        ctx.strokeStyle = c
        ctx.stroke()
      }
    }
    const [a, b] = s
    if (this.mode === 'linear' && a && b) {
      const cm = this.len(this.distance)
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
      const label = this.mode === 'linear' ? String(i + 1) : (CORNER_NAMES[i] ?? '')
      ctx.font = '700 13px system-ui, sans-serif'
      ctx.textAlign = 'left'
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.strokeText(label, q.x + 14, q.y - 12)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, q.x + 14, q.y - 12)
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
