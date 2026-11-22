import { formatStamp, type ProjectSummary } from '../storage/records'
import { el } from './dom'

export interface ProjectsApi {
  list(): Promise<ProjectSummary[]>
  open(id: string): Promise<void>
  duplicate(id: string): Promise<void>
  remove(id: string): Promise<void>
  clearAll(): Promise<void>
}

// Destructive buttons need a second tap within a few seconds.
function confirming(label: string, sure: string, testId: string, action: () => void): HTMLButtonElement {
  const b = el('button', 'btn', label)
  b.type = 'button'
  b.dataset.testid = testId
  let timer = 0
  b.addEventListener('click', () => {
    if (b.dataset.armed) {
      clearTimeout(timer)
      delete b.dataset.armed
      b.textContent = label
      action()
      return
    }
    b.dataset.armed = 'true'
    b.textContent = sure
    timer = window.setTimeout(() => {
      delete b.dataset.armed
      b.textContent = label
    }, 4000)
  })
  return b
}

export class ProjectsPanel {
  readonly root = el('section', 'sheet')
  private list = el('ul', 'proj-list')
  private note = el('p', 'note')
  private urls: string[] = []

  constructor(
    private api: ProjectsApi,
    private currentId: () => string,
    private onClose: () => void,
  ) {
    this.root.setAttribute('aria-label', 'Projekte')
    this.root.hidden = true
    this.note.setAttribute('role', 'status')
    const hint = el(
      'p',
      'hint',
      'Projekte werden automatisch auf diesem Gerät gespeichert. Die Fotos verlassen das Gerät nie.',
    )
    const clear = confirming('Alle lokalen Daten löschen', 'Wirklich alles löschen?', 'clear-all', () =>
      this.guard(async () => {
        await this.api.clearAll()
        location.reload()
      }),
    )
    const close = el('button', 'btn', 'Schliessen')
    close.type = 'button'
    close.dataset.testid = 'projects-close'
    close.addEventListener('click', () => this.onClose())
    this.root.append(hint, this.list, this.note, clear, close)
  }

  show(visible: boolean): void {
    this.root.hidden = !visible
    if (visible) void this.render()
  }

  private async guard(fn: () => Promise<void>): Promise<void> {
    this.note.classList.remove('error')
    this.note.textContent = ''
    try {
      await fn()
    } catch {
      this.note.classList.add('error')
      this.note.textContent = 'Das hat nicht geklappt.'
    }
  }

  async render(): Promise<void> {
    let items: ProjectSummary[] = []
    await this.guard(async () => {
      items = await this.api.list()
    })
    for (const u of this.urls) URL.revokeObjectURL(u)
    this.urls = []
    this.list.replaceChildren()
    if (!items.length) {
      this.list.append(el('li', 'proj-empty', 'Noch keine gespeicherten Projekte.'))
      return
    }
    const current = this.currentId()
    for (const p of items) {
      const li = el('li', 'proj-row')
      li.dataset.testid = 'project-row'
      const img = el('img')
      img.alt = ''
      img.width = 72
      img.height = 54
      if (p.thumb) {
        const url = URL.createObjectURL(p.thumb)
        this.urls.push(url)
        img.src = url
      }
      const meta = el('div', 'proj-meta')
      meta.append(
        el('strong', undefined, p.id === current ? `${p.name} (geöffnet)` : p.name),
        el(
          'span',
          undefined,
          `${formatStamp(p.updated)} · ${p.variants} ${p.variants === 1 ? 'Variante' : 'Varianten'}${p.calibrated ? '' : ' · nicht kalibriert'}`,
        ),
      )
      const open = el('button', 'btn', 'Öffnen')
      open.type = 'button'
      open.dataset.testid = 'project-open'
      open.addEventListener('click', () => void this.guard(() => this.api.open(p.id)))
      const dup = el('button', 'btn', 'Duplizieren')
      dup.type = 'button'
      dup.dataset.testid = 'project-duplicate'
      dup.addEventListener('click', () =>
        void this.guard(async () => {
          await this.api.duplicate(p.id)
          await this.render()
        }),
      )
      const del = confirming('Löschen', 'Wirklich löschen?', 'project-delete', () =>
        void this.guard(async () => {
          await this.api.remove(p.id)
          await this.render()
        }),
      )
      const actions = el('div', 'row')
      actions.append(open, dup, del)
      const text = el('div', 'proj-text')
      text.append(meta, actions)
      li.append(img, text)
      this.list.append(li)
    }
  }
}
