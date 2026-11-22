import { normalizeAngle, setHeight, setWidth } from '../math/motif'
import { formatNumber, parseLength } from '../math/units'
import type { Motif } from '../model/types'
import { el } from './dom'

function field(label: string, input: HTMLElement): HTMLLabelElement {
  const l = el('label', 'field')
  l.append(el('span', undefined, label), input)
  return l
}

function textInput(testId: string): HTMLInputElement {
  const i = el('input')
  i.type = 'text'
  i.inputMode = 'decimal'
  i.autocomplete = 'off'
  i.dataset.testid = testId
  return i
}

function range(min: number, max: number): HTMLInputElement {
  const i = el('input')
  i.type = 'range'
  i.min = String(min)
  i.max = String(max)
  i.step = '1'
  return i
}

export class MotifPanel {
  readonly root = el('section', 'sheet')
  private width = textInput('width')
  private height = textInput('height')
  private lock = el('button', 'btn')
  private rotation = range(-180, 180)
  private opacity = range(0, 100)
  private rotationOut = el('output')
  private opacityOut = el('output')
  private readout = el('p', 'readout')

  constructor(
    private get: () => Motif | null,
    private onEdit: () => void,
  ) {
    this.root.setAttribute('aria-label', 'Motiv')
    this.root.hidden = true
    this.readout.dataset.testid = 'readout'
    this.readout.setAttribute('aria-live', 'polite')
    this.lock.type = 'button'
    this.lock.dataset.testid = 'lock'

    const sizes = el('div', 'row')
    sizes.append(field('Breite (cm)', this.width), this.lock, field('Höhe (cm)', this.height))
    const rot = el('div', 'row')
    rot.append(field('Drehung', this.rotation), this.rotationOut)
    const op = el('div', 'row')
    op.append(field('Deckkraft', this.opacity), this.opacityOut)
    this.root.append(this.readout, sizes, rot, op)

    this.bindSize(this.width, 'w')
    this.bindSize(this.height, 'h')
    this.lock.addEventListener('click', () => {
      const m = this.get()
      if (!m) return
      m.lockAspect = !m.lockAspect
      this.sync()
    })
    this.rotation.addEventListener('input', () => {
      const m = this.get()
      if (!m) return
      m.box = { ...m.box, rot: normalizeAngle(Number(this.rotation.value)) }
      this.changed()
    })
    this.opacity.addEventListener('input', () => {
      const m = this.get()
      if (!m) return
      m.opacity = Number(this.opacity.value)
      this.changed()
    })
  }

  show(visible: boolean): void {
    this.root.hidden = !visible
    if (visible) this.sync()
  }

  private bindSize(input: HTMLInputElement, side: 'w' | 'h'): void {
    const commit = (): void => {
      const m = this.get()
      if (!m) return
      const cm = parseLength(input.value)
      if (cm === null || cm <= 0) {
        input.setAttribute('aria-invalid', 'true')
        this.sync()
        return
      }
      input.removeAttribute('aria-invalid')
      m.box = side === 'w' ? setWidth(m.box, cm, m.aspect, m.lockAspect) : setHeight(m.box, cm, m.aspect, m.lockAspect)
      this.changed()
    }
    input.addEventListener('change', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
    })
  }

  private changed(): void {
    this.sync()
    this.onEdit()
  }

  // Refreshes all fields from the model, except the one being typed in.
  sync(): void {
    const m = this.get()
    if (!m) return
    const { box } = m
    const typing = document.activeElement
    if (typing !== this.width) this.width.value = formatNumber(box.w)
    if (typing !== this.height) this.height.value = formatNumber(box.h)
    this.rotation.value = String(Math.round(box.rot))
    this.rotationOut.textContent = `${Math.round(box.rot)}°`
    this.opacity.value = String(m.opacity)
    this.opacityOut.textContent = `${m.opacity} %`
    this.lock.textContent = m.lockAspect ? 'Seitenverhältnis gesperrt' : 'Seitenverhältnis frei'
    this.lock.setAttribute('aria-pressed', String(m.lockAspect))
    this.readout.textContent = `Breite × Höhe: ${formatNumber(box.w)} × ${formatNumber(box.h)} cm · Mitte: x ${formatNumber(box.x)} cm, y ${formatNumber(box.y)} cm`
  }
}
