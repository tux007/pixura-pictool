import { expect, test } from '@playwright/test'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

async function loaded(page: import('@playwright/test').Page): Promise<ViewerPage> {
  const viewer = new ViewerPage(page)
  await viewer.goto()
  await viewer.loadPhoto(PHOTO)
  await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
  return viewer
}

test.describe('calibration and motif', () => {
  test('calibrates with two points and sizes a motif', async ({ page }) => {
    const viewer = await loaded(page)
    await expect(viewer.calibrateButton).toBeEnabled()
    await viewer.calibrateButton.click()
    await expect(viewer.applyButton).toBeDisabled()

    const { scale } = await viewer.view()
    const c = await viewer.center()
    await page.mouse.click(c.x - 150, c.y)
    await page.mouse.click(c.x + 150, c.y)
    await expect(viewer.applyButton).toBeEnabled()

    await viewer.distanceInput.fill('3 m')
    await viewer.applyButton.click()

    // 300 screen px = 300/scale image px for 300 cm
    await expect(viewer.canvas).toHaveAttribute('data-px-per-cm', /.+/)
    const pxPerCm = Number(await viewer.canvas.getAttribute('data-px-per-cm'))
    expect(pxPerCm).toBeCloseTo(1 / scale, 2)

    await viewer.motifInput.setInputFiles(PHOTO)
    await expect(viewer.readout).toContainText('Breite × Höhe')
    await viewer.widthInput.fill('100')
    await viewer.widthInput.press('Enter')
    await expect(viewer.readout).toContainText('100,0 × 66,7 cm')

    await page.getByTestId('lock').click()
    await viewer.heightInput.fill('1 m')
    await viewer.heightInput.press('Enter')
    await expect(viewer.readout).toContainText('100,0 × 100,0 cm')
  })

  test('warns about short references', async ({ page }) => {
    const viewer = await loaded(page)
    await viewer.calibrateButton.click()
    const c = await viewer.center()
    await page.mouse.click(c.x - 150, c.y)
    await page.mouse.click(c.x + 150, c.y)
    await viewer.distanceInput.fill('60')
    await expect(page.getByText('Kurze Referenz')).toBeVisible()
  })

  test('rejects a missing distance and keeps state on cancel', async ({ page }) => {
    const viewer = await loaded(page)
    await viewer.calibrateButton.click()
    const c = await viewer.center()
    await page.mouse.click(c.x - 150, c.y)
    await page.mouse.click(c.x + 150, c.y)
    await viewer.applyButton.click()
    await expect(page.getByText('Distanz grösser als 0')).toBeVisible()
    await viewer.cancelButton.click()
    await expect(viewer.canvas).not.toHaveAttribute('data-px-per-cm', /.+/)
    await expect(page.getByRole('button', { name: 'Motiv', exact: true })).toBeDisabled()
  })

  test('draws the motif through WebGL after a linear calibration', async ({ page }) => {
    const viewer = await loaded(page)
    await viewer.calibrateButton.click()
    const c = await viewer.center()
    await page.mouse.click(c.x - 150, c.y)
    await page.mouse.click(c.x + 150, c.y)
    await viewer.distanceInput.fill('3 m')
    await viewer.applyButton.click()
    expect(await viewer.motifPixels()).toBe(0)
    await viewer.motifInput.setInputFiles(PHOTO)
    await expect.poll(() => viewer.motifPixels()).toBeGreaterThan(1000)
  })
})

test.describe('perspective calibration', () => {
  test.use({ viewport: { width: 1280, height: 1200 } })

  async function pickCorners(page: import('@playwright/test').Page, viewer: ViewerPage, order: number[]): Promise<void> {
    const c = await viewer.center()
    const corners = [
      [-200, -90],
      [190, -70],
      [210, 90],
      [-180, 80],
    ] as const
    for (const i of order) {
      const o = corners[i] ?? [0, 0]
      await page.mouse.click(c.x + o[0], c.y + o[1])
    }
  }

  test('four corners, rectangle size, motif in perspective', async ({ page }) => {
    const viewer = await loaded(page)
    await viewer.calibrateButton.click()
    await page.getByTestId('mode-perspective').click()
    await pickCorners(page, viewer, [0, 1, 2, 3])
    await expect(viewer.applyButton).toBeEnabled()

    await page.getByLabel('Rechteck-Breite').fill('200')
    await page.getByLabel('Rechteck-Höhe').fill('100')
    await expect(page.getByTestId('quality')).toContainText('Kalibrierfehler')
    await viewer.applyButton.click()

    await expect(viewer.canvas).toHaveAttribute('data-calibration', 'perspective')
    await expect(page.getByText('Perspektive 200,0 × 100,0 cm')).toBeVisible()

    await viewer.motifInput.setInputFiles(PHOTO)
    await expect(viewer.readout).toContainText('Breite × Höhe')
    await expect.poll(() => viewer.motifPixels()).toBeGreaterThan(1000)

    const before = await viewer.motifPixels()
    await viewer.widthInput.fill('50')
    await viewer.widthInput.press('Enter')
    await expect(viewer.readout).toContainText('50,0 × 33,3 cm')
    await expect.poll(() => viewer.motifPixels()).toBeLessThan(before)
  })

  test('rejects corners in the wrong order', async ({ page }) => {
    const viewer = await loaded(page)
    await viewer.calibrateButton.click()
    await page.getByTestId('mode-perspective').click()
    await pickCorners(page, viewer, [0, 3, 2, 1])
    await page.getByLabel('Rechteck-Breite').fill('200')
    await page.getByLabel('Rechteck-Höhe').fill('100')
    await expect(page.getByText('gegen den Uhrzeigersinn')).toBeVisible()
    await viewer.applyButton.click()
    await expect(viewer.canvas).not.toHaveAttribute('data-calibration', /.+/)
  })

  test('switching the mode starts over', async ({ page }) => {
    const viewer = await loaded(page)
    await viewer.calibrateButton.click()
    await pickCorners(page, viewer, [0, 1])
    await expect(viewer.applyButton).toBeEnabled()
    await page.getByTestId('mode-perspective').click()
    await expect(viewer.applyButton).toBeDisabled()
    await expect(page.getByText('Ecke „oben links“')).toBeVisible()
  })
})
