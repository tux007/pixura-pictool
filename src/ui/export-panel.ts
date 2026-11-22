import { canShareFiles } from '../export/share'
import type { Project } from '../model/types'
import { el } from './dom'

export type ExportKind = 'png' | 'pdf'
export type ExportMode = 'share' | 'download'

export class ExportPanel {
  readonly root = el('section', 'sheet')
  private note = el('p', 'note')
  private buttons: HTMLButtonElement[] = []

  constructor(
    private project: Project,
    private run: (kind: ExportKind, mode: ExportMode) => Promise<string>,
  ) {
    this.root.setAttribute('aria-label', 'Export')
    this.root.hidden = true
    this.note.setAttribute('role', 'status')

    const hint = el(
      'p',
      'hint',
      'Exportiert die aktive Variante mit Wandfoto, Motiv, eingezeichneten Massen, Datum und Hinweis.',
    )

    const tol = el('input')
    tol.type = 'text'
    tol.inputMode = 'decimal'
    tol.autocomplete = 'off'
    tol.value = this.fmt(project.toleranceCm)
    tol.dataset.testid = 'tolerance'
    const commit = (): void => {
      const v = Number(tol.value.trim().replace(',', '.'))
      if (Number.isFinite(v) && v >= 0 && v <= 100) project.toleranceCm = v
      tol.value = this.fmt(project.toleranceCm)
    }
    tol.addEventListener('change', commit)
    tol.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit()
    })
    const field = el('label', 'field')
    field.append(el('span', undefined, 'Toleranz in Hinweis (± cm)'), tol)

    const row = el('div', 'row')
    const add = (label: string, id: string, kind: ExportKind, mode: ExportMode): void => {
      const b = el('button', 'btn', label)
      b.type = 'button'
      b.dataset.testid = id
      b.addEventListener('click', () => void this.exec(kind, mode))
      this.buttons.push(b)
      row.append(b)
    }
    if (canShareFiles()) {
      add('PNG teilen', 'export-png-share', 'png', 'share')
      add('PDF teilen', 'export-pdf-share', 'pdf', 'share')
    }
    add('PNG laden', 'export-png-download', 'png', 'download')
    add('PDF laden', 'export-pdf-download', 'pdf', 'download')

    this.root.append(hint, field, row, this.note)
  }

  private fmt(v: number): string {
    return String(v).replace('.', ',')
  }

  private async exec(kind: ExportKind, mode: ExportMode): Promise<void> {
    for (const b of this.buttons) b.disabled = true
    this.note.classList.remove('error')
    this.note.textContent = 'Wird erstellt …'
    try {
      this.note.textContent = await this.run(kind, mode)
    } catch {
      this.note.classList.add('error')
      this.note.textContent = 'Der Export ist fehlgeschlagen.'
    } finally {
      for (const b of this.buttons) b.disabled = false
    }
  }

  show(visible: boolean): void {
    this.root.hidden = !visible
  }
}
