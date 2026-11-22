import { LoadError, loadImage } from '../image/load'
import { MAX_SIZE } from '../math/motif'
import { formatNumber } from '../math/units'
import type { Calibration, Motif, Wall } from '../model/types'
import { CalibrationFlow } from './calibrate'
import { el } from './dom'
import { MotifLayer } from './motif-layer'
import { MotifPanel } from './motif-panel'
import { Viewport } from './viewport'

function fileInput(testId: string, capture?: string): HTMLInputElement {
  const input = el('input')
  input.type = 'file'
  input.accept = 'image/*'
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

export function mountApp(root: HTMLElement): void {
  const bar = el('header', 'bar')
  const pick = button('Foto wählen', 'pick')
  const camera = button('Kamera', 'camera')
  const calibrate = button('Kalibrieren', 'calibrate')
  const motifBtn = button('Motiv', 'motif')
  const fit = button('Einpassen', 'fit')
  const info = el('span', 'info')
  bar.append(pick, camera, calibrate, motifBtn, fit, info)

  const stage = el('main', 'stage')
  const canvas = el('canvas')
  canvas.dataset.testid = 'viewport'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Wandfoto')
  const empty = el('p', 'empty', 'Wandfoto laden, um zu beginnen.')
  const banner = el('p', 'banner')
  banner.setAttribute('role', 'alert')
  banner.hidden = true
  stage.append(canvas, empty, banner)

  const fileEl = fileInput('file-input')
  const cameraEl = fileInput('camera-input', 'environment')
  const motifEl = fileInput('motif-input')
  root.append(bar, stage, fileEl, cameraEl, motifEl)

  let wall: Wall | null = null
  let motif: Motif | null = null

  const viewport = new Viewport(canvas)
  const panel = new MotifPanel(
    () => motif,
    () => viewport.redraw(),
  )
  const motifLayer = new MotifLayer(viewport, () => panel.sync())
  const flow = new CalibrationFlow(viewport, stage, (cal) => onCalibrated(cal))
  viewport.addLayer(motifLayer)
  viewport.addLayer(flow)
  stage.append(panel.root)

  const refresh = (): void => {
    const calibrating = flow.active
    pick.disabled = camera.disabled = calibrating
    calibrate.disabled = !wall || calibrating
    motifBtn.disabled = !wall?.calibration || calibrating
    fit.disabled = !wall
    motifLayer.enabled = !calibrating
    panel.show(!!motif && !calibrating)
    const parts: string[] = []
    if (wall) parts.push(`${wall.width} × ${wall.height} px`)
    if (wall?.calibration) parts.push(`${formatNumber(wall.calibration.pxPerCm, 2)} px/cm`)
    info.textContent = parts.join(' · ')
    if (wall?.calibration) canvas.dataset.pxPerCm = wall.calibration.pxPerCm.toFixed(4)
    else delete canvas.dataset.pxPerCm
    viewport.redraw()
  }

  const showError = (msg: string): void => {
    banner.textContent = msg
    banner.hidden = false
  }

  const load = async (input: HTMLInputElement): Promise<ImageBitmap | null> => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return null
    banner.hidden = true
    const prev = info.textContent
    info.textContent = 'Bild wird geladen …'
    try {
      return await loadImage(file)
    } catch (err) {
      showError(err instanceof LoadError ? err.message : 'Das Bild konnte nicht geladen werden.')
      return null
    } finally {
      info.textContent = prev
    }
  }

  const onWall = async (input: HTMLInputElement): Promise<void> => {
    const image = await load(input)
    if (!image) return
    wall?.image.close()
    motif?.image.close()
    motif = null
    wall = { image, width: image.width, height: image.height, calibration: null }
    motifLayer.wall = wall
    motifLayer.motif = null
    viewport.setImage(image)
    empty.hidden = true
    refresh()
  }

  const onMotif = async (): Promise<void> => {
    const image = await load(motifEl)
    const cal = wall?.calibration
    if (!image || !wall || !cal) return
    motif?.image.close()
    const aspect = image.width / image.height
    const wallWidth = wall.width / cal.pxPerCm
    const w = Math.min(MAX_SIZE, Math.max(5, Math.round((wallWidth * 0.4) / 5) * 5))
    const c = viewport.centerImagePoint()
    motif = {
      image,
      aspect,
      opacity: 100,
      lockAspect: true,
      box: { x: c.x / cal.pxPerCm, y: c.y / cal.pxPerCm, w, h: w / aspect, rot: 0 },
    }
    motifLayer.motif = motif
    refresh()
  }

  const onCalibrated = (cal: Calibration | null): void => {
    if (cal && wall) wall.calibration = cal
    refresh()
  }

  pick.addEventListener('click', () => fileEl.click())
  camera.addEventListener('click', () => cameraEl.click())
  motifBtn.addEventListener('click', () => motifEl.click())
  fit.addEventListener('click', () => viewport.fit())
  calibrate.addEventListener('click', () => {
    if (!wall) return
    banner.hidden = true
    flow.start(wall.image)
    refresh()
  })
  fileEl.addEventListener('change', () => void onWall(fileEl))
  cameraEl.addEventListener('change', () => void onWall(cameraEl))
  motifEl.addEventListener('change', () => void onMotif())
  refresh()
}
