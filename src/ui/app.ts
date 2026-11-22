import { MotifRenderer } from '../gl/motif-renderer'
import { LoadError, loadImage } from '../image/load'
import { imageToWall, wallToImage, wallWidthCm } from '../math/calibration'
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
  // bottom to top: wall photo, motif (WebGL), transparent overlay that takes the input
  const base = el('canvas', 'layer')
  base.dataset.testid = 'wall-canvas'
  const glCanvas = el('canvas', 'layer')
  glCanvas.dataset.testid = 'motif-canvas'
  const canvas = el('canvas')
  canvas.dataset.testid = 'viewport'
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', 'Wandfoto')
  const empty = el('p', 'empty', 'Wandfoto laden, um zu beginnen.')
  const banner = el('p', 'banner')
  banner.setAttribute('role', 'alert')
  banner.hidden = true
  stage.append(base, glCanvas, canvas, empty, banner)

  const fileEl = fileInput('file-input')
  const cameraEl = fileInput('camera-input', 'environment')
  const motifEl = fileInput('motif-input')
  root.append(bar, stage, fileEl, cameraEl, motifEl)

  let wall: Wall | null = null
  let motif: Motif | null = null

  const viewport = new Viewport(canvas, base)
  const renderer = MotifRenderer.create(glCanvas)
  if (!renderer) {
    banner.textContent = 'Dieser Browser unterstützt WebGL 2 nicht. Motive können nicht angezeigt werden.'
    banner.hidden = false
  }
  const panel = new MotifPanel(
    () => motif,
    () => viewport.redraw(),
  )
  const motifLayer = new MotifLayer(viewport, renderer, () => panel.sync())
  const flow = new CalibrationFlow(viewport, stage, (cal) => onCalibrated(cal))
  viewport.addLayer(motifLayer)
  viewport.addLayer(flow)
  stage.append(panel.root)

  const refresh = (): void => {
    const calibrating = flow.active
    pick.disabled = camera.disabled = calibrating
    calibrate.disabled = !wall || calibrating
    motifBtn.disabled = !wall?.calibration || calibrating || !renderer
    fit.disabled = !wall
    motifLayer.enabled = !calibrating
    panel.show(!!motif && !calibrating)
    const parts: string[] = []
    const cal = wall?.calibration
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
    const w = Math.min(MAX_SIZE, Math.max(5, Math.round((wallWidthCm(cal, wall.width) * 0.4) / 5) * 5))
    const c = imageToWall(cal, viewport.centerImagePoint())
    motif = {
      image,
      aspect,
      opacity: 100,
      lockAspect: true,
      box: { x: c.x, y: c.y, w, h: w / aspect, rot: 0 },
    }
    motifLayer.motif = motif
    refresh()
  }

  const onCalibrated = (cal: Calibration | null): void => {
    if (cal && wall) {
      // The wall coordinate system changes with the calibration: keep the motif's centre where it
      // appears in the photo. Its size in cm stays as entered.
      const old = wall.calibration
      if (motif && old) {
        const at = imageToWall(cal, wallToImage(old, motif.box))
        motif.box = { ...motif.box, x: at.x, y: at.y }
      }
      wall.calibration = cal
    }
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
