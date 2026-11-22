import { fitWithin } from '../math/size'

export const MAX_EDGE = 4096
const MAX_BYTES = 60 * 1024 * 1024

export class LoadError extends Error {}

export async function loadImage(file: File): Promise<ImageBitmap> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new LoadError('Diese Datei ist kein Bild.')
  }
  if (file.size > MAX_BYTES) {
    throw new LoadError('Das Bild ist zu gross (maximal 60 MB).')
  }

  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new LoadError('Das Bild konnte nicht gelesen werden. Bitte ein JPEG oder PNG verwenden.')
  }

  const target = fitWithin(bmp.width, bmp.height, MAX_EDGE)
  if (target.w === bmp.width && target.h === bmp.height) return bmp

  try {
    return await createImageBitmap(bmp, {
      resizeWidth: target.w,
      resizeHeight: target.h,
      resizeQuality: 'high',
    })
  } catch {
    throw new LoadError('Das Bild ist zu gross zum Verarbeiten.')
  } finally {
    bmp.close()
  }
}
