import type { MotifRenderer } from '../gl/motif-renderer'
import { formatNumber } from '../math/units'
import { MAX_VARIANTS, type Project } from '../model/types'
import { renderScene } from '../render/scene'
import { el } from './dom'

export class VariantTabs {
  readonly root = el('div', 'tabs')

  constructor(
    private project: Project,
    private onSelect: (i: number) => void,
    private onAdd: () => void,
  ) {
    this.root.setAttribute('role', 'tablist')
    this.root.setAttribute('aria-label', 'Varianten')
  }

  render(): void {
    const { variants, active } = this.project
    this.root.replaceChildren()
    variants.forEach((_, i) => {
      const b = el('button', 'btn tab', `Variante ${i + 1}`)
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.setAttribute('aria-selected', String(i === active))
      b.dataset.testid = `variant-${i}`
      b.addEventListener('click', () => this.onSelect(i))
      this.root.append(b)
    })
    const add = el('button', 'btn tab', '+')
    add.type = 'button'
    add.setAttribute('aria-label', 'Variante hinzufügen')
    add.dataset.testid = 'variant-add'
    add.disabled = variants.length >= MAX_VARIANTS
    add.addEventListener('click', () => this.onAdd())
    this.root.append(add)
  }
}

// Side-by-side comparison of all variants, rendered like the export (same WebGL pipeline).
export function openCompare(project: Project, gl: MotifRenderer): void {
  const { wall } = project
  if (!wall?.calibration) return
  const dialog = el('dialog', 'compare')
  dialog.setAttribute('aria-label', 'Vergleich der Varianten')
  dialog.dataset.testid = 'compare-dialog'
  const grid = el('div', 'compare-grid')
  project.variants.forEach((motif, i) => {
    const fig = el('figure')
    const canvas = renderScene(gl, { wall, motif, guides: project.guides, showDims: project.showDims }, 640)
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', `Variante ${i + 1}`)
    fig.append(
      canvas,
      el('figcaption', undefined, `Variante ${i + 1}: ${formatNumber(motif.box.w)} × ${formatNumber(motif.box.h)} cm`),
    )
    grid.append(fig)
  })
  const close = el('button', 'btn primary', 'Schliessen')
  close.type = 'button'
  close.addEventListener('click', () => dialog.close())
  dialog.addEventListener('close', () => dialog.remove())
  dialog.append(grid, close)
  document.body.append(dialog)
  dialog.showModal()
}
