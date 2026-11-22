import { fitWithin } from '../math/size'

export const MAX_EDGE = 4096
const MAX_BYTES = 60 * 1024 * 1024

export class LoadError extends Error {}

// "II*\0" (little endian) or "MM\0*" (big endian); BigTIFF is not supported.
export function isTiff(head: Uint8Array): boolean {
  const [a, b, c, d] = head
  return (a === 0x49 && b === 0x49 && c === 0x2a && d === 0) || (a === 0x4d && b === 0x4d && c === 0 && d === 0x2a)
}

// TIFF is not decodable by most browsers, so it goes through our own decoder (same result
// everywhere). The decoder is a separate chunk, only fetched when a TIFF is actually opened.
async function decodeTiffFile(file: File): Promise<ImageBitmap> {
  const tiff = await import('./tiff')
  // let the "loading" message paint before the synchronous decode blocks the thread
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  try {
    const { width, height, data } = tiff.decodeTiff(await file.arrayBuffer())
    // the buffer is a plain ArrayBuffer (never shared), which the type system cannot see
    return await createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height))
  } catch (err) {
    if (err instanceof tiff.TiffError && err.kind === 'too-big') {
      const mp = Math.round(tiff.MAX_TIFF_PIXELS / 1e6)
      throw new LoadError(`Das TIFF ist zu gross (maximal ${mp} Megapixel). Bitte eine kleinere Auflösung exportieren.`)
    }
    throw new LoadError(
      'Das TIFF konnte nicht gelesen werden. Unterstützt sind Graustufen, RGB und CMYK mit 8 oder 16 Bit (unkomprimiert, LZW, Deflate, PackBits).',
    )
  }
}

async function decodeBitmap(file: File): Promise<ImageBitmap> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  if (isTiff(head)) return decodeTiffFile(file)
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export async function loadImage(file: File): Promise<ImageBitmap> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new LoadError('Diese Datei ist kein Bild.')
  }
  if (file.size > MAX_BYTES) {
    throw new LoadError('Das Bild ist zu gross (maximal 60 MB).')
  }

  let bmp: ImageBitmap
  try {
    bmp = await decodeBitmap(file)
  } catch (err) {
    if (err instanceof LoadError) throw err
    throw new LoadError('Das Bild konnte nicht gelesen werden. Bitte ein JPEG, PNG oder TIFF verwenden.')
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
