import { clearAll, deleteProject, duplicateProject, getProject, listProjects, putProject } from '../storage/db'
import { defaultName, newId, toFile, toRecord } from '../storage/records'
import { buildPdf } from '../export/pdf'
import { buildTiff } from '../export/tiff'
import { download, shareFile } from '../export/share'
import { MotifRenderer } from '../gl/motif-renderer'
import { LoadError, loadImage } from '../image/load'
import { imageToWall, wallToImage, wallWidthCm } from '../math/calibration'
import { checkRules, DEFAULT_RULES, describeCheck } from '../math/clearance'
import { GUIDE_SHORT, guideDistances } from '../math/guides'
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
import { MotifLayer } from './motif-layer'
import { MotifPanel } from './motif-panel'
import { openHelp } from './help'
import { ProjectsPanel } from './projects-panel'
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

function button(label: string, testId: string): HTMLButtonElement {
  const b = el('button', 'btn', label)
  b.type = 'button'
  b.dataset.testid = testId
  return b
}

type Sheet = 'motif' | 'guides' | 'export' | 'projects'

export function mountApp(root: HTMLElement): void {
  const bar = el('header', 'bar')
  const pick = button('Foto wählen', 'pick')
  const camera = button('Kamera', 'camera')
  const calibrate = button('Kalibrieren', 'calibrate')
  const motifBtn = button('Motiv', 'motif')
  const guidesBtn = button('Linien', 'guides')
  const exportBtn = button('Export', 'export')
  const compareBtn = button('Vergleich', 'compare')
  const projectsBtn = button('Projekte', 'projects')
  const helpBtn = button('Anleitung', 'help')
  const fit = button('Einpassen', 'fit')
  const info = el('span', 'info')
  const title = el('h1', 'sr-only', 'Pixura Wandvorschau')
  bar.append(title, pick, camera, calibrate, motifBtn, guidesBtn, exportBtn, compareBtn, projectsBtn, helpBtn, fit, info)

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
  const empty = el(
    'p',
    'empty',
    'Wandfoto laden, um zu beginnen. Tipps zum Fotografieren stehen unter „Anleitung“.',
  )
  const banner = el('p', 'banner')
  banner.setAttribute('role', 'alert')
  banner.hidden = true
  stage.append(base, glCanvas, canvas, empty, banner)

  const fileEl = fileInput('file-input')
  const cameraEl = fileInput('camera-input', 'environment')
  const motifEl = fileInput('motif-input')
  root.append(bar, stage, fileEl, cameraEl, motifEl)

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
  let sheet: Sheet = 'motif'
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
    scheduleSave()
  }
  const panel = new MotifPanel(
    () => activeMotif(project),
    () => {
      viewport.redraw()
      guidesPanel.sync()
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
  )
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
  stage.append(tabs.root, panel.root, guidesPanel.root, exportPanel.root, projectsPanel.root)

  function refresh(): void {
    const { wall } = project
    const cal = wall?.calibration
    const motif = activeMotif(project)
    const calibrating = flow.active

    pick.disabled = camera.disabled = calibrating
    calibrate.disabled = !wall || calibrating
    motifBtn.disabled = !cal || calibrating || !renderer
    guidesBtn.disabled = !cal || calibrating
    exportBtn.disabled = !motif || calibrating
    compareBtn.disabled = project.variants.length < 2 || calibrating
    fit.disabled = !wall
    projectsBtn.disabled = calibrating
    guidesBtn.setAttribute('aria-pressed', String(sheet === 'guides'))
    exportBtn.setAttribute('aria-pressed', String(sheet === 'export'))
    projectsBtn.setAttribute('aria-pressed', String(sheet === 'projects'))

    motifLayer.enabled = !calibrating
    guideLayer.enabled = !calibrating
    guideLayer.editable = sheet === 'guides'
    panel.show(!!motif && sheet === 'motif' && !calibrating)
    guidesPanel.show(!!cal && sheet === 'guides' && !calibrating)
    exportPanel.show(!!motif && sheet === 'export' && !calibrating)
    projectsPanel.show(sheet === 'projects' && !calibrating)
    tabs.root.hidden = !motif || calibrating
    tabs.render()
    guidesPanel.sync()

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
    sheet = 'motif'
    viewport.setImage(image)
    empty.hidden = true
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
    sheet = 'motif'
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
    sheet = 'motif'
    banner.hidden = true
    viewport.setImage(wallImage)
    empty.hidden = true
    refresh()
  }

  function addVariant(): void {
    const m = activeMotif(project)
    if (!m || project.variants.length >= MAX_VARIANTS) return
    project.variants.push({ ...m, box: { ...m.box } })
    project.active = project.variants.length - 1
    sheet = 'motif'
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

  pick.addEventListener('click', () => fileEl.click())
  camera.addEventListener('click', () => cameraEl.click())
  motifBtn.addEventListener('click', () => motifEl.click())
  fit.addEventListener('click', () => viewport.fit())
  guidesBtn.addEventListener('click', () => {
    sheet = sheet === 'guides' ? 'motif' : 'guides'
    refresh()
  })
  exportBtn.addEventListener('click', () => {
    sheet = sheet === 'export' ? 'motif' : 'export'
    refresh()
  })
  compareBtn.addEventListener('click', () => {
    const gl = getExportGl()
    if (gl) openCompare(project, gl)
  })
  projectsBtn.addEventListener('click', () => {
    sheet = sheet === 'projects' ? 'motif' : 'projects'
    refresh()
  })
  helpBtn.addEventListener('click', openHelp)
  calibrate.addEventListener('click', () => {
    if (!project.wall) return
    banner.hidden = true
    flow.start(project.wall.image)
    refresh()
  })
  fileEl.addEventListener('change', () => void onWall(fileEl))
  cameraEl.addEventListener('change', () => void onWall(cameraEl))
  motifEl.addEventListener('change', () => void onMotif())
  refresh()
}
