import { imageToWall } from '../math/calibration'
import { GUIDE_KINDS, GUIDE_LABEL, guideDistances, guideValueAt, type GuideKind } from '../math/guides'
import { activeMotif, type Project } from '../model/types'
import { fmtCm } from '../render/annotations'
import { el } from './dom'
import type { Viewport } from './viewport'

export class GuidesPanel {
  readonly root = el('section', 'sheet')
  private status = new Map<GuideKind, HTMLElement>()
  private prompt = el('p', 'note')
  private picking: GuideKind | null = null

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
      'Boden, Decke und Wandkanten markieren, dann zeigt das Tool die Abstände des Motivs. „Setzen“ antippen, danach die Stelle im Foto. Gesetzte Linien lassen sich ziehen.',
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

    const check = el('label', 'check')
    const box = el('input')
    box.type = 'checkbox'
    box.checked = this.project.showDims
    box.dataset.testid = 'show-dims'
    box.addEventListener('change', () => {
      this.project.showDims = box.checked
      this.onChange()
    })
    check.append(box, el('span', undefined, 'Masse im Bild anzeigen'))
    this.root.append(check, this.prompt)
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

  sync(): void {
    const m = activeMotif(this.project)
    const dist = m ? guideDistances(m.box, this.project.guides) : []
    for (const kind of GUIDE_KINDS) {
      const state = this.status.get(kind)
      if (!state) continue
      const d = dist.find((x) => x.kind === kind)
      const set = this.project.guides[kind] !== undefined
      state.textContent = !set ? 'nicht gesetzt' : d ? `Abstand ${fmtCm(d.cm)}` : 'gesetzt'
    }
  }
}
