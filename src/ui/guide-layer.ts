import { imageToWall, wallToImage } from '../math/calibration'
import { GUIDE_KINDS, guideEndpoints, guideValueAt, type GuideKind } from '../math/guides'
import { toScreen, type Pt, type View } from '../math/view'
import { activeMotif, type Project } from '../model/types'
import { drawAnnotations } from '../render/annotations'
import type { Layer } from './layer'
import type { Viewport } from './viewport'

const HIT = 18

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Draws guide lines and dimensions; lines can be dragged while `editable`.
export class GuideLayer implements Layer {
  enabled = true
  editable = false
  private drag: GuideKind | null = null

  constructor(
    private vp: Viewport,
    private project: Project,
    private onChange: () => void,
  ) {}

  draw(ctx: CanvasRenderingContext2D, view: View): void {
    const { wall } = this.project
    const cal = wall?.calibration
    if (!this.enabled || !wall || !cal) return
    drawAnnotations({
      ctx,
      map: (p) => toScreen(view, wallToImage(cal, p)),
      unit: 1,
      cal,
      img: { w: wall.width, h: wall.height },
      box: activeMotif(this.project)?.box ?? null,
      guides: this.project.guides,
      showDims: this.project.showDims,
      rules: this.project.rules,
    })
  }

  down(p: Pt, view: View): boolean {
    const { wall } = this.project
    const cal = wall?.calibration
    if (!this.enabled || !this.editable || !wall || !cal) return false
    const sp = toScreen(view, p)
    for (const kind of GUIDE_KINDS) {
      const v = this.project.guides[kind]
      if (v === undefined) continue
      const [a, b] = guideEndpoints(cal, { w: wall.width, h: wall.height }, kind, v).map((w) =>
        toScreen(view, wallToImage(cal, w)),
      ) as [Pt, Pt]
      if (distToSegment(sp, a, b) < HIT) {
        this.drag = kind
        return true
      }
    }
    return false
  }

  move(p: Pt): void {
    const cal = this.project.wall?.calibration
    if (!this.drag || !cal) return
    const v = guideValueAt(this.drag, imageToWall(cal, p))
    if (!Number.isFinite(v)) return
    this.project.guides[this.drag] = v
    this.vp.redraw()
    this.onChange()
  }

  up(): void {
    this.drag = null
  }
}
