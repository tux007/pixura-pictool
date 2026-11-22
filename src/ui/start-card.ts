import { listProjects } from '../storage/db'
import { formatStamp, type ProjectSummary } from '../storage/records'
import { el, isSmallScreen } from './dom'

const NOTE_KEY = 'pixura.smallDeviceNote'

// Phones and small tablets are too small to place a motif exactly. A hint, not a block.
function deviceNote(): HTMLElement | null {
  try {
    if (!isSmallScreen(screen.width, screen.height) || localStorage.getItem(NOTE_KEY)) return null
  } catch {
    return null
  }
  const box = el('div', 'device-note')
  box.setAttribute('role', 'note')
  box.dataset.testid = 'device-note'
  const ok = el('button', 'btn', 'Verstanden')
  ok.type = 'button'
  ok.dataset.testid = 'device-note-dismiss'
  ok.addEventListener('click', () => {
    try {
      localStorage.setItem(NOTE_KEY, '1')
    } catch {
      // private mode: the hint simply shows again next time
    }
    box.remove()
  })
  box.append(
    el(
      'p',
      undefined,
      'Hinweis: Die Wandvorschau ist für Tablets ab ca. 10 Zoll und für den Desktop gedacht. Auf Handys und kleinen Tablets (z. B. iPad mini) ist die Fläche zu klein, um ein Motiv genau zu platzieren. Du kannst die App trotzdem nutzen.',
    ),
    ok,
  )
  return box
}

export interface StartApi {
  pick(): void
  camera(): void
  help(): void
  open(id: string): Promise<void>
  allProjects(): void
}

// Shown instead of an empty screen until a wall photo is loaded.
export class StartCard {
  readonly root = el('section', 'start-card')
  private recent = el('div', 'recent')
  private list = el('ul', 'recent-list')

  constructor(private api: StartApi) {
    this.root.dataset.testid = 'start-card'
    this.root.setAttribute('aria-label', 'Start')

    const title = el('h2', undefined, 'Wandvorschau starten')
    const text = el(
      'p',
      'start-text',
      'Fotografiere die Wand oder wähle ein vorhandenes Foto. Danach führt dich die App Schritt für Schritt: Massstab festlegen, Motiv platzieren, Wandabstände prüfen, exportieren.',
    )

    const camera = el('button', 'btn primary big', 'Foto aufnehmen')
    camera.type = 'button'
    camera.dataset.testid = 'start-camera'
    camera.addEventListener('click', () => this.api.camera())
    const pick = el('button', 'btn big', 'Foto wählen')
    pick.type = 'button'
    pick.dataset.testid = 'start-pick'
    pick.addEventListener('click', () => this.api.pick())
    const row = el('div', 'start-actions')
    row.append(camera, pick)

    const recentTitle = el('h3', undefined, 'Zuletzt bearbeitet')
    const all = el('button', 'btn', 'Alle Projekte')
    all.type = 'button'
    all.dataset.testid = 'start-all'
    all.addEventListener('click', () => this.api.allProjects())
    this.recent.append(recentTitle, this.list, all)
    this.recent.hidden = true

    const help = el('button', 'btn link', 'So fotografierst du die Wand')
    help.type = 'button'
    help.dataset.testid = 'start-help'
    help.addEventListener('click', () => this.api.help())

    const note = deviceNote()
    this.root.append(title, text, ...(note ? [note] : []), row, this.recent, help)
  }

  show(visible: boolean): void {
    this.root.hidden = !visible
    if (visible) void this.refresh()
  }

  private async refresh(): Promise<void> {
    const items: ProjectSummary[] = await listProjects(3).catch(() => [])
    this.list.replaceChildren()
    this.recent.hidden = items.length === 0
    for (const p of items) {
      const li = el('li')
      const b = el('button', 'btn recent-item')
      b.type = 'button'
      b.dataset.testid = 'start-open'
      b.append(
        el('strong', undefined, p.name),
        el('span', undefined, `${formatStamp(p.updated)} · ${p.variants} ${p.variants === 1 ? 'Variante' : 'Varianten'}`),
      )
      b.addEventListener('click', () => void this.api.open(p.id).catch(() => {}))
      li.append(b)
      this.list.append(li)
    }
  }
}
