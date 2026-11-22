import { clearAll, deleteProject, duplicateProject, getProject, listProjects, putProject } from '../storage/db'
import { defaultName, newId, toFile, toRecord } from '../storage/records'
import { buildPdf } from '../export/pdf'
import { buildTiff } from '../export/tiff'
import { download, shareFile } from '../export/share'
import { MotifRenderer } from '../gl/motif-renderer'
import { LoadError, loadImage } from '../image/load'
import { imageToWall, wallToImage, wallWidthCm } from '../math/calibration'
import { checkRules, DEFAULT_RULES, describeCheck } from '../math/clearance'
import { GUIDE_KINDS, GUIDE_SHORT, guideDistances } from '../math/guides'
import { MAX_SIZE } from '../math/motif'
import { formatNumber } from '../math/units'
import { activeMotif, MAX_VARIANTS, type Calibration, type Project } from '../model/types'
import { fmtCm } from '../render/annotations'
import { renderScene } from '../render/scene'
import { CalibrationFlow } from './calibrate'
import { el } from './dom'
import { ExportPanel, type ExportKind, type ExportMode } from './export-panel'
import { GuideLayer } from './guide-layer'
import { GuidesPanel } from './guides-panel'
import { openHelp } from './help'
import { MotifLayer } from './motif-layer'
import { MotifPanel } from './motif-panel'
import { ProjectsPanel } from './projects-panel'
import { StartCard } from './start-card'
import {
  canEnter,
  clampStep,
  firstIncomplete,
  LINES_NEEDED,
  nextOf,
  prevOf,
  stateOf,
  STEPS,
  stepOf,
  type Progress,
  type StepId,
} from './steps'
import { openCompare, VariantTabs } from './variants'
import { Viewport } from './viewport'

const EXPORT_WIDTH = 3000

const pad = (n: number): string => String(n).padStart(2, '0')
const stamp = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dateCh = (d: Date): string => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
const tol = (v: number): string => (Number.isInteger(v) ? String(v) : formatNumber(v, 1))

// Word-wraps text for the export footer, which has a fixed width.
function wrapText(text: string, max = 88): string[] {
  const lines: string[] = []
  let cur = ''
  for (const word of text.split(' ')) {
    if (cur && cur.length + 1 + word.length > max) {
      lines.push(cur)
      cur = word
    } else {
      cur = cur ? `${cur} ${word}` : word
    }
  }
  if (cur) lines.push(cur)
  return lines
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> =>
  new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality),
  )

function fileInput(testId: string, capture?: string): HTMLInputElement {
  const input = el('input')
  input.type = 'file'
  input.accept = 'image/*,.tif,.tiff'
  input.hidden = true
  input.dataset.testid = testId
  if (capture) input.setAttribute('capture', capture)
  return input
}

// On narrow screens the panels sit on top of the photo: let the user fold them away.
function collapsible(root: HTMLElement): void {
  const toggle = el('button', 'sheet-toggle', 'Einklappen')
  toggle.type = 'button'
  toggle.dataset.testid = 'sheet-toggle'
  toggle.setAttribute('aria-expanded', 'true')
  toggle.addEventListener('click', () => {
    const folded = root.classList.toggle('collapsed')
    toggle.textContent = folded ? 'Ausklappen' : 'Einklappen'
    toggle.setAttribute('aria-expanded', String(!folded))
  })
  root.prepend(toggle)
}

function button(label: string, testId: string, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label)
  b.type = 'button'
  b.dataset.testid = testId
  return b
}

export function mountApp(root: HTMLElement): void {
  // --- header: step bar and menu ---
  const top = el('header', 'top')
  const title = el('h1', 'sr-only', 'Pixura Wandvorschau')
  const stepNav = el('nav', 'steps')
  stepNav.setAttribute('aria-label', 'Schritte')
  const stepList = el('ol')
  stepNav.append(stepList)
  const chips = new Map<StepId, { button: HTMLButtonElement; num: HTMLElement }>()
  STEPS.forEach((s, i) => {
    const li = el('li')
    const b = el('button', 'step')
    b.type = 'button'
    b.dataset.testid = `step-${s.id}`
    const num = el('span', 'num', String(i + 1))
    b.append(num, el('span', 'lbl', s.label))
    li.append(b)
    stepList.append(li)
    chips.set(s.id, { button: b, num })
  })
  const menuBtn = button('Menü', 'menu')
  menuBtn.setAttribute('aria-haspopup', 'true')
  menuBtn.setAttribute('aria-expanded', 'false')
  const menu = el('div', 'menu-pop')
  menu.hidden = true
  const menuProjects = button('Projekte', 'menu-projects')
  const menuHelp = button('Anleitung', 'menu-help')
  menu.append(menuProjects, menuHelp)
  top.append(title, stepNav, menuBtn, menu)

  // --- guidance: what to do in this step ---
  const guide = el('section', 'guide')
  guide.setAttribute('aria-label', 'Aktueller Schritt')
  const guideText = el('div', 'guide-text')
  const guideStep = el('p', 'guide-step')
  const guideTitle = el('h2', 'guide-title')
  const guideHint = el('p', 'guide-hint')
  guideHint.dataset.testid = 'step-hint'
  guideHint.setAttribute('aria-live', 'polite')
  guideText.append(guideStep, guideTitle, guideHint)
  const guideActions = el('div', 'guide-actions')
  const pick = button('Anderes Foto wählen', 'pick')
  const camera = button('Neue Aufnahme', 'camera')
  const calibrate = button('Kalibrieren starten', 'calibrate', 'btn primary')
  const motifBtn = button('Motiv wählen', 'motif', 'btn primary')
  const compareBtn = button('Varianten vergleichen', 'compare')
  const info = el('span', 'info')
  info.dataset.testid = 'info'
  guideActions.append(pick, camera, calibrate, motifBtn, compareBtn, info)
  guide.append(guideText, guideActions)

  // --- stage ---
  const stage = el('main', 'stage')
  // bottom to top: wall photo, motif (WebGL), transparent overlay that takes the input
  const base = el('canvas', 'layer')
  base.dataset.testid = 'wall-canvas'
  const glCanvas = el('canvas', 'layer')
  glCanvas.dataset.testid = 'motif-canvas'
  const canvas = el('canvas')
  canvas.dataset.testid = 'viewport'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Wandfoto')
  const banner = el('p', 'banner')
  banner.setAttribute('role', 'alert')
  banner.hidden = true
  const fit = button('Einpassen', 'fit', 'btn fit')
  stage.append(base, glCanvas, canvas, banner, fit)

  // --- footer: back / next ---
  const footer = el('footer', 'nav')
  const back = button('', 'back')
  const navHint = el('p', 'nav-hint')
  navHint.dataset.testid = 'nav-hint'
  navHint.setAttribute('role', 'status')
  const next = button('', 'next')
  footer.append(back, navHint, next)

  const fileEl = fileInput('file-input')
  const cameraEl = fileInput('camera-input', 'environment')
  const motifEl = fileInput('motif-input')
  root.append(top, guide, stage, footer, fileEl, cameraEl, motifEl)

  const project: Project = {
    id: newId(),
    name: '',
    updated: 0,
    wall: null,
    variants: [],
    active: 0,
    guides: {},
    rules: { ...DEFAULT_RULES },
    showDims: true,
    toleranceCm: 5,
  }
  let step: StepId = 'photo'
  let showProjects = false
  let menuOpen = false
  let exportGl: MotifRenderer | null = null

  const viewport = new Viewport(canvas, base)
  const renderer = MotifRenderer.create(glCanvas)
  if (!renderer) {
    banner.textContent = 'Dieser Browser unterstützt WebGL 2 nicht. Motive können nicht angezeigt werden.'
    banner.hidden = false
  }

  const syncPanels = (): void => {
    panel.sync()
    guidesPanel.sync()
    renderGuide()
    scheduleSave()
  }
  const panel = new MotifPanel(
    () => activeMotif(project),
    () => {
      viewport.redraw()
      guidesPanel.sync()
      renderGuide()
      scheduleSave()
    },
    () => removeVariant(),
    () => rulesInfo(),
  )
  const guidesPanel = new GuidesPanel(viewport, project, () => refresh())
  const exportPanel = new ExportPanel(project, (kind, mode) => doExport(kind, mode), () => scheduleSave())
  const projectsPanel = new ProjectsPanel(
    {
      list: () => listProjects(),
      open: (id) => openProject(id),
      duplicate: async (id) => {
        await flushSave()
        await duplicateProject(id)
      },
      remove: async (id) => {
        if (id === project.id) {
          // deleted while open: stay on screen, but stop saving it until another project is loaded
          clearTimeout(saveTimer)
          detached = true
        }
        await deleteProject(id)
      },
      clearAll: async () => {
        clearTimeout(saveTimer)
        await clearAll()
      },
    },
    () => project.id,
    () => {
      showProjects = false
      refresh()
    },
  )
  const startCard = new StartCard({
    pick: () => fileEl.click(),
    camera: () => cameraEl.click(),
    help: openHelp,
    open: (id) => openProject(id),
    allProjects: () => {
      showProjects = true
      refresh()
    },
  })
  const tabs = new VariantTabs(
    project,
    (i) => {
      project.active = i
      refresh()
    },
    () => addVariant(),
  )
  const guideLayer = new GuideLayer(viewport, project, syncPanels)
  const motifLayer = new MotifLayer(viewport, renderer, project, syncPanels)
  const flow = new CalibrationFlow(viewport, stage, (cal) => onCalibrated(cal))
  // hit-tested last to first: calibration, motif handles, then guide lines
  viewport.addLayer(guideLayer)
  viewport.addLayer(motifLayer)
  viewport.addLayer(flow)
  stage.append(startCard.root, tabs.root, panel.root, guidesPanel.root, exportPanel.root, projectsPanel.root)
  for (const sheet of [panel.root, guidesPanel.root, exportPanel.root, projectsPanel.root]) collapsible(sheet)

  // --- step flow ---

  const progress = (): Progress => ({
    hasWall: !!project.wall,
    calibrated: !!project.wall?.calibration,
    hasMotif: !!activeMotif(project),
    linesSet: GUIDE_KINDS.filter((k) => project.guides[k] !== undefined).length,
  })

  let flash = ''
  let flashTimer = 0
  function say(msg: string): void {
    flash = msg
    clearTimeout(flashTimer)
    flashTimer = window.setTimeout(() => {
      flash = ''
      renderNav()
    }, 3500)
    renderNav()
  }

  function go(id: StepId): void {
    if (flow.active) return say('Erst die Kalibrierung abschliessen oder abbrechen.')
    const e = canEnter(id, progress())
    if (!e.ok) return say(e.reason ?? '')
    step = id
    showProjects = false
    // the assistant starts by itself the first time; afterwards there is a "Neu kalibrieren" button
    if (id === 'calibrate' && !project.wall?.calibration) startCalibration()
    refresh()
  }

  function startCalibration(): void {
    const { wall } = project
    if (!wall || flow.active) return
    banner.hidden = true
    flow.start(wall.image)
  }

  function guideTexts(p: Progress): string {
    const m = activeMotif(project)
    switch (step) {
      case 'photo':
        return p.hasWall
          ? 'Foto geladen. Passt der Ausschnitt? Dann weiter mit „Kalibrieren“, sonst ein anderes Foto wählen oder aufnehmen.'
          : 'Fotografiere die Wand frontal und ganz (nicht im Ultraweitwinkel) oder wähle ein vorhandenes Foto.'
      case 'calibrate':
        if (flow.active) return 'Folge der Anleitung im Fenster: Punkte antippen, echte Distanz eingeben, „Übernehmen“.'
        return p.calibrated
          ? 'Kalibriert. Weiter mit dem Motiv, oder neu kalibrieren, falls das Ergebnis nicht stimmt.'
          : 'Zeige dem Tool ein bekanntes Mass: zwei Punkte einer Strecke (z. B. Massband) oder die vier Ecken eines Rechtecks (Tür, Fenster).'
      case 'motif':
        return m
          ? 'Schiebe das Motiv an die richtige Stelle und passe die Grösse an (Eckgriffe oder Masse). Optional: mit „+“ weitere Varianten anlegen, z. B. in anderer Grösse.'
          : 'Wähle das Motiv, das gedruckt werden soll (JPEG, PNG oder TIFF).'
      case 'distances': {
        const base = 'Setze Decke, Boden und beide Innenecken, damit das Tool die wallPen-Mindestabstände prüft.'
        if (p.linesSet < LINES_NEEDED) return `${base} Noch ${LINES_NEEDED - p.linesSet} von ${LINES_NEEDED} Linien offen.`
        const r = m ? checkRules(m.box, project.guides, project.rules) : null
        if (r?.state === 'violated') return `${base} Achtung: Das Motiv unterschreitet einen Mindestabstand.`
        return `${base} Alle Linien sind gesetzt, weiter zum Export.`
      }
      case 'export': {
        const r = m ? checkRules(m.box, project.guides, project.rules) : null
        if (r?.state === 'violated') {
          return 'Achtung: Das Motiv unterschreitet einen wallPen-Mindestabstand. Zurück zu „Abstände“, um es zu korrigieren, oder trotzdem exportieren.'
        }
        return 'Prüfe das Ergebnis und exportiere die aktive Variante als PNG, PDF oder TIFF. Optional: Varianten vergleichen.'
      }
    }
  }

  function renderGuide(): void {
    const p = progress()
    const idx = STEPS.findIndex((s) => s.id === step)
    guideStep.textContent = `Schritt ${idx + 1} von ${STEPS.length}`
    guideTitle.textContent = stepOf(step).title
    guideHint.textContent = guideTexts(p)
    const violated = (step === 'export' || step === 'distances') && /Achtung/.test(guideHint.textContent)
    guideHint.classList.toggle('warn', violated)
  }

  function renderNav(): void {
    const p = progress()
    const prev = prevOf(step)
    const nxt = nextOf(step)
    const locked = flow.active
    back.hidden = !prev
    if (prev) {
      back.textContent = `‹ Zurück: ${stepOf(prev).label}`
      back.setAttribute('aria-disabled', String(locked))
    }
    next.hidden = !nxt
    let reason: string | null = null
    if (nxt) {
      const e = canEnter(nxt, p)
      reason = locked ? 'Erst die Kalibrierung abschliessen oder abbrechen.' : e.reason
      next.textContent = `Weiter: ${stepOf(nxt).label} ›`
      next.setAttribute('aria-disabled', String(!e.ok || locked))
      next.classList.toggle('primary', e.ok && !locked)
    }
    navHint.textContent = flash || reason || ''
  }

  function refresh(): void {
    const { wall } = project
    const cal = wall?.calibration
    const motif = activeMotif(project)
    const calibrating = flow.active
    const p = progress()
    step = clampStep(step, p)

    STEPS.forEach((s, i) => {
      const c = chips.get(s.id)
      if (!c) return
      const state = stateOf(s.id, step, p)
      c.button.dataset.state = state
      c.num.textContent = state === 'done' ? '✓' : String(i + 1)
      if (state === 'current') c.button.setAttribute('aria-current', 'step')
      else c.button.removeAttribute('aria-current')
      c.button.setAttribute('aria-disabled', String(state === 'locked' || calibrating))
      const note = state === 'done' ? ', erledigt' : state === 'locked' ? ', noch gesperrt' : ''
      c.button.setAttribute('aria-label', `Schritt ${i + 1}: ${s.label}${note}`)
    })

    pick.hidden = camera.hidden = !(step === 'photo' && wall)
    calibrate.hidden = !(step === 'calibrate' && wall && !calibrating)
    calibrate.textContent = cal ? 'Neu kalibrieren' : 'Kalibrieren starten'
    calibrate.classList.toggle('primary', !cal)
    motifBtn.hidden = !(step === 'motif' && cal)
    motifBtn.textContent = motif ? 'Anderes Motiv wählen' : 'Motiv wählen'
    motifBtn.classList.toggle('primary', !motif)
    motifBtn.disabled = !renderer
    compareBtn.hidden = !(step === 'export' && project.variants.length >= 2)
    fit.hidden = !wall
    startCard.show(!wall)

    const view = step === 'motif' || step === 'distances'
    motifLayer.enabled = view && !calibrating
    guideLayer.enabled = !calibrating
    guideLayer.editable = step === 'distances' && !showProjects
    panel.show(!!motif && step === 'motif' && !calibrating && !showProjects)
    guidesPanel.show(!!cal && step === 'distances' && !calibrating && !showProjects)
    exportPanel.show(!!motif && step === 'export' && !calibrating && !showProjects)
    projectsPanel.show(showProjects && !calibrating)
    tabs.root.hidden = !motif || calibrating || step === 'photo' || step === 'calibrate'
    tabs.render()
    guidesPanel.sync()
    menuProjects.setAttribute('aria-pressed', String(showProjects))

    const parts: string[] = []
    if (wall) parts.push(`${wall.width} × ${wall.height} px`)
    if (cal?.mode === 'linear') parts.push(`${formatNumber(cal.pxPerCm, 2)} px/cm`)
    if (cal?.mode === 'perspective') {
      parts.push(`Perspektive ${formatNumber(cal.widthCm)} × ${formatNumber(cal.heightCm)} cm`)
    }
    info.textContent = parts.join(' · ')
    if (cal) canvas.dataset.calibration = cal.mode
    else delete canvas.dataset.calibration
    if (cal?.mode === 'linear') canvas.dataset.pxPerCm = cal.pxPerCm.toFixed(4)
    else delete canvas.dataset.pxPerCm
    renderGuide()
    renderNav()
    viewport.redraw()
    scheduleSave()
  }

  const showError = (msg: string): void => {
    banner.textContent = msg
    banner.hidden = false
  }

  const load = async (input: HTMLInputElement): Promise<{ image: ImageBitmap; file: File } | null> => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return null
    banner.hidden = true
    const prev = info.textContent
    info.textContent = 'Bild wird geladen …'
    try {
      return { image: await loadImage(file), file }
    } catch (err) {
      showError(err instanceof LoadError ? err.message : 'Das Bild konnte nicht geladen werden.')
      return null
    } finally {
      info.textContent = prev
    }
  }

  const onWall = async (input: HTMLInputElement): Promise<void> => {
    const loaded = await load(input)
    if (!loaded) return
    const { image, file } = loaded
    await flushSave()
    project.wall?.image.close()
    detached = false
    project.id = newId()
    project.updated = Date.now()
    project.name = defaultName(project.updated)
    project.wall = { image, source: file, width: image.width, height: image.height, calibration: null }
    project.variants = []
    project.active = 0
    project.guides = {}
    project.rules = { ...DEFAULT_RULES }
    step = 'photo'
    showProjects = false
    viewport.setImage(image)
    refresh()
  }

  const onMotif = async (): Promise<void> => {
    const loaded = await load(motifEl)
    const { wall } = project
    const cal = wall?.calibration
    if (!loaded || !wall || !cal) return
    const { image, file } = loaded
    const aspect = image.width / image.height
    const current = activeMotif(project)
    if (current) {
      // another motif in the active variant: keep position and width
      current.image = image
      current.source = file
      current.aspect = aspect
      current.box = { ...current.box, h: current.box.w / aspect, rot: 0 }
    } else {
      const w = Math.min(MAX_SIZE, Math.max(5, Math.round((wallWidthCm(cal, wall.width) * 0.4) / 5) * 5))
      const c = imageToWall(cal, viewport.centerImagePoint())
      project.variants = [
        {
          image,
          source: file,
          aspect,
          opacity: 100,
          lockAspect: true,
          box: { x: c.x, y: c.y, w, h: w / aspect, rot: 0 },
        },
      ]
      project.active = 0
    }
    refresh()
  }

  // --- persistence: every change is saved to IndexedDB after a short pause ---

  const getExportGl = (): MotifRenderer | null => {
    exportGl ??= MotifRenderer.create(document.createElement('canvas'))
    return exportGl
  }

  async function makeThumb(): Promise<Blob | null> {
    const { wall } = project
    if (!wall) return null
    const motif = activeMotif(project)
    const gl = getExportGl()
    let c: HTMLCanvasElement
    if (motif && wall.calibration && gl) {
      c = renderScene(gl, { wall, motif, guides: {}, showDims: false }, 320)
    } else {
      const k = Math.min(1, 320 / wall.width)
      c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(wall.width * k))
      c.height = Math.max(1, Math.round(wall.height * k))
      c.getContext('2d')?.drawImage(wall.image, 0, 0, c.width, c.height)
    }
    return toBlob(c, 'image/jpeg', 0.7)
  }

  let saveTimer = 0
  let saveChain: Promise<void> = Promise.resolve()
  let saveFailed = false
  let detached = false

  async function saveNow(): Promise<void> {
    if (!project.wall || detached) return
    try {
      project.updated = Date.now()
      await putProject(toRecord(project, await makeThumb()))
      saveFailed = false
      void navigator.storage?.persist?.()
    } catch {
      if (!saveFailed) showError('Speichern auf diesem Gerät ist nicht möglich (Speicher voll oder gesperrt).')
      saveFailed = true
    }
  }

  function scheduleSave(): void {
    if (!project.wall || detached) return
    clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveChain = saveChain.then(saveNow)
    }, 800)
  }

  async function flushSave(): Promise<void> {
    clearTimeout(saveTimer)
    saveChain = saveChain.then(saveNow)
    await saveChain
  }

  async function openProject(id: string): Promise<void> {
    const rec = await getProject(id)
    if (!rec) throw new Error('project unreadable')
    const wallImage = await loadImage(toFile(rec.wall))
    const variants = await Promise.all(
      rec.variants.map(async (v) => ({
        image: await loadImage(toFile(v)),
        source: toFile(v),
        box: v.box,
        aspect: v.aspect,
        opacity: v.opacity,
        lockAspect: v.lockAspect,
      })),
    )
    await flushSave()
    project.wall?.image.close()
    detached = false
    project.id = rec.id
    project.name = rec.name
    project.updated = rec.updated
    project.wall = {
      image: wallImage,
      source: toFile(rec.wall),
      width: wallImage.width,
      height: wallImage.height,
      calibration: rec.calibration,
    }
    project.variants = variants
    project.active = rec.active
    project.guides = rec.guides
    project.rules = rec.rules ?? { ...DEFAULT_RULES }
    project.showDims = rec.showDims
    project.toleranceCm = rec.toleranceCm
    showProjects = false
    banner.hidden = true
    viewport.setImage(wallImage)
    // continue where the work stopped
    step = firstIncomplete(progress())
    refresh()
  }

  function addVariant(): void {
    const m = activeMotif(project)
    if (!m || project.variants.length >= MAX_VARIANTS) return
    project.variants.push({ ...m, box: { ...m.box } })
    project.active = project.variants.length - 1
    refresh()
  }

  function removeVariant(): void {
    project.variants.splice(project.active, 1)
    project.active = Math.max(0, Math.min(project.active, project.variants.length - 1))
    refresh()
  }

  function onCalibrated(cal: Calibration | null): void {
    const { wall } = project
    if (cal && wall) {
      // The wall coordinate system changes with the calibration: keep every motif's centre where
      // it appears in the photo (size in cm stays as entered). Guide lines cannot be carried over.
      const old = wall.calibration
      if (old) {
        for (const m of project.variants) {
          const at = imageToWall(cal, wallToImage(old, m.box))
          m.box = { ...m.box, x: at.x, y: at.y }
        }
      }
      if (Object.keys(project.guides).length) {
        project.guides = {}
        showError('Die Hilfslinien wurden zurückgesetzt, weil sich die Kalibrierung geändert hat.')
      }
      wall.calibration = cal
    }
    refresh()
  }

  function rulesInfo(): { text: string; state: 'ok' | 'violated' | 'unchecked' | 'off' } | null {
    const m = activeMotif(project)
    if (!m) return null
    const c = checkRules(m.box, project.guides, project.rules)
    return { text: describeCheck(c, project.rules), state: c.state }
  }

  function summary(index: number, now: Date): string[] {
    const m = project.variants[index]
    if (!m) return []
    const lines = [`Variante ${index + 1}: Motiv ${formatNumber(m.box.w)} × ${formatNumber(m.box.h)} cm`]
    const dist = guideDistances(m.box, project.guides)
    if (dist.length) lines.push('Abstände: ' + dist.map((d) => `${GUIDE_SHORT[d.kind]} ${fmtCm(d.cm)}`).join(', '))
    if (project.rules.enabled) {
      const check = checkRules(m.box, project.guides, project.rules)
      if (check.state !== 'unchecked') lines.push(...wrapText(`wallPen: ${describeCheck(check, project.rules)}`))
      lines.push('Vor Ort prüfen: Druckbereich hindernisfrei, 90 cm vor der Wand an Decke und Boden frei.')
    }
    lines.push(`Vorschau, Massangaben ca. ±${tol(project.toleranceCm)} cm`)
    lines.push(`Erstellt am ${dateCh(now)} mit Pixura Wandvorschau`)
    return lines
  }

  async function doExport(kind: ExportKind, mode: ExportMode): Promise<string> {
    const { wall } = project
    const motif = activeMotif(project)
    if (!wall || !motif) return 'Es gibt nichts zu exportieren.'
    const exportGl = getExportGl()
    if (!exportGl) return 'WebGL 2 ist nicht verfügbar.'

    const now = new Date()
    const idx = project.active
    const lines = summary(idx, now)
    const scene = { wall, motif, guides: project.guides, showDims: project.showDims, rules: project.rules }
    const name = `wandvorschau-variante-${idx + 1}-${stamp(now)}`
    let file: File
    if (kind === 'png') {
      const blob = await toBlob(renderScene(exportGl, scene, EXPORT_WIDTH, lines), 'image/png')
      file = new File([blob], `${name}.png`, { type: 'image/png' })
    } else if (kind === 'tiff') {
      const c = renderScene(exportGl, scene, EXPORT_WIDTH, lines)
      const ctx = c.getContext('2d')
      if (!ctx) throw new Error('Canvas 2D is not available')
      const tiff = await buildTiff(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height)
      file = new File([tiff as BlobPart], `${name}.tiff`, { type: 'image/tiff' })
    } else {
      const c = renderScene(exportGl, scene, EXPORT_WIDTH)
      const jpeg = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer())
      const pdf = buildPdf({
        jpeg,
        imgW: c.width,
        imgH: c.height,
        title: `Pixura Wandvorschau - Variante ${idx + 1}`,
        lines,
      })
      file = new File([pdf as BlobPart], `${name}.pdf`, { type: 'application/pdf' })
    }

    const label = kind.toUpperCase()
    if (mode === 'download') {
      download(file)
      return `${label} gespeichert.`
    }
    const result = await shareFile(file, 'Pixura Wandvorschau')
    if (result === 'shared') return `${label} geteilt.`
    if (result === 'cancelled') return 'Teilen abgebrochen.'
    return `Teilen nicht möglich, ${label} wurde gespeichert.`
  }

  // --- events ---

  for (const s of STEPS) chips.get(s.id)?.button.addEventListener('click', () => go(s.id))
  back.addEventListener('click', () => {
    const prev = prevOf(step)
    if (prev) go(prev)
  })
  next.addEventListener('click', () => {
    const nxt = nextOf(step)
    if (nxt) go(nxt)
  })

  const setMenu = (open: boolean): void => {
    menuOpen = open
    menu.hidden = !open
    menuBtn.setAttribute('aria-expanded', String(open))
  }
  menuBtn.addEventListener('click', () => setMenu(!menuOpen))
  document.addEventListener('click', (e) => {
    if (menuOpen && !top.contains(e.target as Node)) setMenu(false)
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen) setMenu(false)
  })
  menuProjects.addEventListener('click', () => {
    showProjects = !showProjects
    setMenu(false)
    refresh()
  })
  menuHelp.addEventListener('click', () => {
    setMenu(false)
    openHelp()
  })

  pick.addEventListener('click', () => fileEl.click())
  camera.addEventListener('click', () => cameraEl.click())
  motifBtn.addEventListener('click', () => motifEl.click())
  fit.addEventListener('click', () => viewport.fit())
  compareBtn.addEventListener('click', () => {
    const gl = getExportGl()
    if (gl) openCompare(project, gl)
  })
  calibrate.addEventListener('click', () => {
    startCalibration()
    refresh()
  })
  fileEl.addEventListener('change', () => void onWall(fileEl))
  cameraEl.addEventListener('change', () => void onWall(cameraEl))
  motifEl.addEventListener('change', () => void onMotif())
  refresh()
}
