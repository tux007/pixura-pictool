import { LoadError, loadImage } from '../image/load'
import type { Wall } from '../model/types'
import { Viewport } from './viewport'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text) node.textContent = text
  return node
}

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
  const fit = button('Einpassen', 'fit')
  fit.disabled = true
  const info = el('span', 'info')
  bar.append(pick, camera, fit, info)

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
  root.append(bar, stage, fileEl, cameraEl)

  const viewport = new Viewport(canvas)
  let wall: Wall | null = null

  const showError = (msg: string): void => {
    banner.textContent = msg
    banner.hidden = false
  }

  const onFile = async (input: HTMLInputElement): Promise<void> => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    banner.hidden = true
    info.textContent = 'Foto wird geladen …'
    try {
      const image = await loadImage(file)
      wall?.image.close()
      wall = { image, width: image.width, height: image.height }
      viewport.setImage(image)
      empty.hidden = true
      fit.disabled = false
      info.textContent = `${wall.width} × ${wall.height} px`
    } catch (err) {
      info.textContent = wall ? `${wall.width} × ${wall.height} px` : ''
      showError(err instanceof LoadError ? err.message : 'Das Foto konnte nicht geladen werden.')
    }
  }

  pick.addEventListener('click', () => fileEl.click())
  camera.addEventListener('click', () => cameraEl.click())
  fit.addEventListener('click', () => viewport.fit())
  fileEl.addEventListener('change', () => void onFile(fileEl))
  cameraEl.addEventListener('change', () => void onFile(cameraEl))
}
