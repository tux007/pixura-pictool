import { imageToWall } from '../math/calibration'
import {
  checkRules,
  describeCheck,
  fitToArea,
  maxScaleAtCenter,
  minDistance,
  printLimits,
  scaleBox,
} from '../math/clearance'
import { GUIDE_KINDS, GUIDE_LABEL, guideDistances, guideValueAt, type GuideKind } from '../math/guides'
import { formatNumber } from '../math/units'
import { activeMotif, type Project } from '../model/types'
import { fmtCm, fmtMin } from '../render/annotations'
import { el } from './dom'
import type { Viewport } from './viewport'

function checkbox(label: string, testId: string, onChange: (checked: boolean) => void): { row: HTMLElement; box: HTMLInputElement } {
  const row = el('label', 'check')
  const box = el('input')
  box.type = 'checkbox'
  box.dataset.testid = testId
  box.addEventListener('change', () => onChange(box.checked))
  row.append(box, el('span', undefined, label))
  return { row, box }
}

export class GuidesPanel {
  readonly root = el('section', 'sheet')
  private status = new Map<GuideKind, HTMLElement>()
  private prompt = el('p', 'note')
  private picking: GuideKind | null = null
  private dims: HTMLInputElement
  private enabled: HTMLInputElement
  private rail: HTMLInputElement
  private skirting = el('input')
  private rulesStatus = el('p', 'rules-line')
  private maxLine = el('p', 'max-line')
  private fitMax = el('button', 'btn', 'Maximal einpassen')

  constructor(
    private vp: Viewport,
    private project: Project,
    private onChange: () => void,
  ) {
    this.root.setAttribute('aria-label', 'Hilfslinien')
    this.root.hidden = true
    this.prompt.setAttribute('role', 'status')

    const hint = el(
      'p',
      'hint',
      'Boden, Decke und die Innenecken links und rechts markieren, dann zeigt das Tool die Abstände des Motivs. „Setzen“ antippen, danach die Stelle im Foto. Gesetzte Linien lassen sich ziehen.',
    )
    this.root.append(hint)

    for (const kind of GUIDE_KINDS) {
      const row = el('div', 'row guide-row')
      const name = el('strong', undefined, GUIDE_LABEL[kind])
      const state = el('span', 'guide-state')
      state.dataset.testid = `guide-${kind}`
      this.status.set(kind, state)
      const set = el('button', 'btn', 'Setzen')
      set.type = 'button'
      set.dataset.testid = `set-${kind}`
      const clear = el('button', 'btn', 'Entfernen')
      clear.type = 'button'
      clear.dataset.testid = `clear-${kind}`
      set.addEventListener('click', () => this.pick(kind))
      clear.addEventListener('click', () => {
        delete this.project.guides[kind]
        this.cancelPick()
        this.onChange()
      })
      row.append(name, state, set, clear)
      this.root.append(row)
    }

    const dims = checkbox('Masse im Bild anzeigen', 'show-dims', (v) => {
      this.project.showDims = v
      this.onChange()
    })
    this.dims = dims.box
    this.root.append(dims.row)

    // --- wallPen distances ---
    const rulesTitle = el('strong', 'rules-title', 'wallPen-Mindestabstände')
    const enabled = checkbox('Mindestabstände prüfen und anzeigen', 'rules-enabled', (v) => {
      this.project.rules.enabled = v
      this.onChange()
    })
    this.enabled = enabled.box
    const rail = checkbox('Mit Schiene drucken (Boden mind. 30 statt 25 cm)', 'rules-rail', (v) => {
      this.project.rules.rail = v
      this.onChange()
    })
    this.rail = rail.box

    this.skirting.type = 'text'
    this.skirting.inputMode = 'decimal'
    this.skirting.autocomplete = 'off'
    this.skirting.dataset.testid = 'skirting'
    const commit = (): void => {
      const v = Number(this.skirting.value.trim().replace(',', '.'))
      if (Number.isFinite(v) && v >= 0 && v <= 100 && v !== this.project.rules.skirtingCm) {
        this.project.rules.skirtingCm = v
        this.onChange()
      }
      this.skirting.value = String(this.project.rules.skirtingCm).replace('.', ',')
    }
    this.skirting.addEventListener('change', commit)
    this.skirting.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
    })
    const skirtingField = el('label', 'field')
    skirtingField.append(el('span', undefined, 'Fussleiste in cm (0 = keine, Abstand zählt ab Oberkante)'), this.skirting)

    this.rulesStatus.dataset.testid = 'rules-status'
    this.rulesStatus.setAttribute('role', 'status')
    this.maxLine.dataset.testid = 'max-size'
    this.fitMax.type = 'button'
    this.fitMax.dataset.testid = 'fit-max'
    this.fitMax.addEventListener('click', () => this.fit())

    const todo = el('details', 'todo')
    todo.append(el('summary', undefined, 'Vor Ort prüfen'))
    const list = el('ul')
    for (const t of [
      'Wandfläche im ganzen Druckbereich frei von Hindernissen.',
      'Decke vor der Wand: 90 cm frei von Hindernissen.',
      'Boden vor der Wand: 90 cm frei von Hindernissen und möglichst eben.',
    ]) {
      list.append(el('li', undefined, t))
    }
    todo.append(list)

    this.root.append(rulesTitle, enabled.row, rail.row, skirtingField, this.rulesStatus, this.maxLine, this.fitMax, todo, this.prompt)
  }

  show(visible: boolean): void {
    this.root.hidden = !visible
    if (!visible) this.cancelPick()
    else this.sync()
  }

  private pick(kind: GuideKind): void {
    this.picking = kind
    this.prompt.textContent = `Tippe im Foto auf die Linie „${GUIDE_LABEL[kind]}“.`
    this.vp.setTapHandler((p) => {
      const cal = this.project.wall?.calibration
      if (!cal) return
      const v = guideValueAt(kind, imageToWall(cal, p))
      if (Number.isFinite(v)) this.project.guides[kind] = v
      this.cancelPick()
      this.onChange()
    })
  }

  private cancelPick(): void {
    if (!this.picking) return
    this.picking = null
    this.prompt.textContent = ''
    this.vp.setTapHandler(null)
  }

  // Scales the motif up (or down) to fill the printable area, centred.
  private fit(): void {
    const m = activeMotif(this.project)
    if (!m) return
    const fit = fitToArea(m.box, printLimits(this.project.guides, this.project.rules))
    if (!fit) {
      this.prompt.textContent = 'Zum Einpassen müssen alle vier Linien gesetzt sein und der Druckbereich muss Platz bieten.'
      return
    }
    this.prompt.textContent = ''
    m.box = fit
    this.onChange()
  }

  sync(): void {
    const { rules, guides } = this.project
    const m = activeMotif(this.project)
    const dist = m ? guideDistances(m.box, guides) : []
    for (const kind of GUIDE_KINDS) {
      const state = this.status.get(kind)
      if (!state) continue
      const d = dist.find((x) => x.kind === kind)
      const set = guides[kind] !== undefined
      let text = !set ? 'nicht gesetzt' : d ? `Abstand ${fmtCm(d.cm)}` : 'gesetzt'
      let bad = false
      if (set && d && rules.enabled) {
        const min = minDistance(kind, rules)
        bad = d.cm < min - 0.05
        text += bad ? ` · min. ${fmtMin(min)}: ${fmtCm(min - d.cm)} zu wenig` : ` · min. ${fmtMin(min)}: ok`
      }
      state.textContent = text
      state.classList.toggle('bad', bad)
    }

    this.dims.checked = this.project.showDims
    this.enabled.checked = rules.enabled
    this.rail.checked = rules.rail
    this.rail.disabled = !rules.enabled
    this.skirting.disabled = !rules.enabled
    if (document.activeElement !== this.skirting) this.skirting.value = String(rules.skirtingCm).replace('.', ',')

    const check = m ? checkRules(m.box, guides, rules) : null
    this.rulesStatus.textContent = check ? describeCheck(check, rules) : ''
    this.rulesStatus.classList.toggle('bad', check?.state === 'violated')
    this.rulesStatus.classList.toggle('good', check?.state === 'ok')

    const limits = printLimits(guides, rules)
    const s = m && rules.enabled ? maxScaleAtCenter(m.box, limits) : null
    if (!m || !rules.enabled) this.maxLine.textContent = ''
    else if (s === null) this.maxLine.textContent = 'Maximale Grösse: Linien setzen, dann rechnet das Tool sie aus.'
    else if (s <= 0) this.maxLine.textContent = 'An dieser Position ist im Druckbereich kein Platz.'
    else {
      const b = scaleBox(m.box, s)
      this.maxLine.textContent = `Maximal an dieser Position: ${formatNumber(b.w)} × ${formatNumber(b.h)} cm (gleiche Form, um die Mitte vergrössert).`
    }
    this.fitMax.disabled = !m || !rules.enabled
  }
}
