import type { Mat3 } from '../math/homography'
import type { Box } from '../math/motif'
import type { PerspectiveQuality } from '../math/perspective'
import type { Pt } from '../math/view'

export interface LinearCalibration {
  mode: 'linear'
  pxPerCm: number
}

// h maps wall centimetres to image pixels, hInv the other way round.
export interface PerspectiveCalibration {
  mode: 'perspective'
  h: Mat3
  hInv: Mat3
  widthCm: number
  heightCm: number
  quad: Pt[]
  quality: PerspectiveQuality
}

export type Calibration = LinearCalibration | PerspectiveCalibration

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
