import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { buildTiff } from '../src/export/tiff'
import { decodeTiff } from '../src/image/tiff'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

function gradient(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d[i] = (x * 255) / w
      d[i + 1] = (y * 255) / h
      d[i + 2] = 120
      d[i + 3] = 255
    }
  }
  return d
}

const tiffFile = async (w: number, h: number, opts = {}, name = 'bild.tif') => ({
  name,
  mimeType: 'image/tiff',
  buffer: Buffer.from(await buildTiff(gradient(w, h), w, h, opts)),
})

async function calibrated(page: Page): Promise<{ viewer: ViewerPage; c: { x: number; y: number } }> {
  const viewer = new ViewerPage(page)
  await viewer.goto()
  await viewer.loadPhoto(PHOTO)
  await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
  const c = await viewer.calibrateLinear()
  return { viewer, c }
}

test.describe('TIFF import', () => {
  test('opens a compressed TIFF as the wall photo', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(await tiffFile(600, 400))
    await expect(viewer.canvas).toHaveAttribute('data-ready', 'true')
    await expect(page.getByText('600 × 400 px')).toBeVisible()
    await expect.poll(() => viewer.centerAlpha()).toBe(255)
  })

  test('opens an uncompressed TIFF', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(await tiffFile(300, 200, { compress: false }, 'roh.tiff'))
    await expect(page.getByText('300 × 200 px')).toBeVisible()
  })

  test('applies the TIFF orientation tag', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    // stored 400 x 600 with "rotate 90 degrees clockwise": shows as 600 x 400
    await viewer.loadPhoto(await tiffFile(400, 600, { orientation: 6 }))
    await expect(page.getByText('600 × 400 px')).toBeVisible()
  })

  test('uses a TIFF as the motif', async ({ page }) => {
    const { viewer } = await calibrated(page)
    await viewer.addMotif(await tiffFile(600, 400, {}, 'motiv.tif'), 100)
    await expect(viewer.readout).toContainText('100,0 × 66,7 cm')
    await expect.poll(() => viewer.motifPixels()).toBeGreaterThan(1000)
  })

  test('loads a 12 MP TIFF in reasonable time', async ({ page }) => {
    test.setTimeout(90_000)
    const viewer = new ViewerPage(page)
    await viewer.goto()
    const file = await tiffFile(4000, 3000)
    const start = Date.now()
    await viewer.loadPhoto(file)
    await expect(page.getByText('4000 × 3000 px')).toBeVisible({ timeout: 60_000 })
    const ms = Date.now() - start
    console.log(`12 MP TIFF (${Math.round(file.buffer.length / 1e6)} MB) loaded in ${ms} ms`)
    expect(ms).toBeLessThan(30_000)
  })

  test('explains a broken TIFF', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    const junk = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]), Buffer.alloc(40, 7)])
    await viewer.loadPhoto({ name: 'kaputt.tif', mimeType: 'image/tiff', buffer: junk })
    await expect(viewer.alert).toContainText('TIFF konnte nicht gelesen werden')
  })
})

test.describe('TIFF export', () => {
  test('downloads a compressed TIFF that decodes back to the preview', async ({ page }) => {
    const { viewer, c } = await calibrated(page)
    await viewer.addMotif(PHOTO, 100)
    await viewer.setGuides(c, { ceiling: -200, floor: 200, left: -300, right: 250 })
    await viewer.goTo('export')

    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-tiff-download').click(),
    ])
    expect(dl.suggestedFilename()).toMatch(/^wandvorschau-variante-1-\d{4}-\d{2}-\d{2}\.tiff$/)
    const bytes = readFileSync(await dl.path())
    expect([...bytes.subarray(0, 4)]).toEqual([0x49, 0x49, 0x2a, 0])

    const out = decodeTiff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer)
    expect(out.width).toBe(1200)
    expect(out.height).toBeGreaterThan(800) // photo plus the text band
    // a plain wall cell far from the motif keeps the photo colour (#efe9dc)
    const i = (50 * out.width + 50) * 4
    expect([out.data[i], out.data[i + 1], out.data[i + 2], out.data[i + 3]]).toEqual([239, 233, 220, 255])
    // deflate keeps the file far below the raw size
    expect(bytes.length).toBeLessThan((out.width * out.height * 3) / 2)
  })
})
