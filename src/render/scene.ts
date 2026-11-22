import type { MotifRenderer } from '../gl/motif-renderer'
import { wallToImage } from '../math/calibration'
import type { RuleSettings } from '../math/clearance'
import type { Guides } from '../math/guides'
import type { Motif, Wall } from '../model/types'
import { drawAnnotations } from './annotations'

export interface SceneInput {
  wall: Wall
  motif: Motif
  guides: Guides
  showDims: boolean
  rules?: RuleSettings
}

// Composes the wall photo, the motif (via WebGL, same pipeline as on screen) and the dimensions
// into one canvas of at most `maxWidth` px, with an optional text band underneath.
export function renderScene(
  gl: MotifRenderer,
  s: SceneInput,
  maxWidth: number,
  footer: readonly string[] = [],
): HTMLCanvasElement {
  const cal = s.wall.calibration
  if (!cal) throw new Error('wall is not calibrated')
  const k = Math.min(1, maxWidth / s.wall.width)
  const w = Math.round(s.wall.width * k)
  const h = Math.round(s.wall.height * k)
  const u = Math.max(1, w / 1200)
  const band = footer.length ? Math.round((footer.length * 28 + 28) * u) : 0

  const out = document.createElement('canvas')
  out.width = w
  out.height = h + band
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(s.wall.image, 0, 0, w, h)

  gl.render(s.motif, cal, { scale: k, tx: 0, ty: 0 }, { w, h }, 1)
  ctx.drawImage(gl.canvas, 0, 0)

  drawAnnotations({
    ctx,
    map: (p) => {
      const i = wallToImage(cal, p)
      return { x: i.x * k, y: i.y * k }
    },
    unit: u,
    cal,
    img: { w: s.wall.width, h: s.wall.height },
    box: s.motif.box,
    guides: s.guides,
    showDims: s.showDims,
    rules: s.rules,
  })

  if (band) {
    ctx.fillStyle = '#14213d'
    ctx.font = `${20 * u}px system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    footer.forEach((line, i) => ctx.fillText(line, 20 * u, h + 16 * u + i * 28 * u))
  }
  return out
}
