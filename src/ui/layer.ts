import type { Pt, View } from '../math/view'

// Overlay on the viewport. Points are image pixels; drawing uses CSS pixels (dpr already applied).
export interface Layer {
  draw(ctx: CanvasRenderingContext2D, view: View): void
  down(p: Pt, view: View): boolean
  move(p: Pt, view: View): void
  up(): void
}
