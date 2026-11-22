import type { Box } from '../math/motif'

// 'perspective' joins in M3.
export type Calibration = { mode: 'linear'; pxPerCm: number }

export interface Wall {
  image: ImageBitmap
  width: number
  height: number
  calibration: Calibration | null
}

export interface Motif {
  image: ImageBitmap
  box: Box
  aspect: number
  opacity: number
  lockAspect: boolean
}
