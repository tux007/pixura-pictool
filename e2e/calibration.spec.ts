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
})
