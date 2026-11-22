import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

// Calibrated so that 1 screen pixel = 1 cm, motif 100 cm wide in the middle of the view.
async function setup(page: Page): Promise<{ viewer: ViewerPage; c: { x: number; y: number } }> {
  const viewer = new ViewerPage(page)
  await viewer.goto()
  await viewer.loadPhoto(PHOTO)
  await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
  await viewer.calibrateButton.click()
  const c = await viewer.center()
  await page.mouse.click(c.x - 150, c.y - 100)
  await page.mouse.click(c.x + 150, c.y - 100)
  await viewer.distanceInput.fill('300')
  await viewer.applyButton.click()
  await viewer.motifInput.setInputFiles(PHOTO)
  await viewer.widthInput.fill('100')
  await viewer.widthInput.press('Enter')
  await expect(viewer.readout).toContainText('100,0 × 66,7 cm')
  return { viewer, c }
}

test.describe('guide lines', () => {
  test('shows the distances from the motif to floor, ceiling and wall edges', async ({ page }) => {
    const { c } = await setup(page)
    await page.getByTestId('guides').click()

    await page.getByTestId('set-floor').click()
    await page.mouse.click(c.x - 300, c.y + 200)
    await page.getByTestId('set-ceiling').click()
    await page.mouse.click(c.x - 300, c.y - 200)
    await page.getByTestId('set-left').click()
    await page.mouse.click(c.x - 300, c.y + 100)
    await page.getByTestId('set-right').click()
    await page.mouse.click(c.x + 250, c.y + 100)

    // motif 100 x 66.7 cm centred in the view, lines at known offsets (1 px = 1 cm)
    await expect(page.getByTestId('guide-floor')).toContainText('Abstand 167 cm')
    await expect(page.getByTestId('guide-ceiling')).toContainText('Abstand 167 cm')
    await expect(page.getByTestId('guide-left')).toContainText('Abstand 250 cm')
    await expect(page.getByTestId('guide-right')).toContainText('Abstand 200 cm')

    await page.getByTestId('clear-floor').click()
    await expect(page.getByTestId('guide-floor')).toHaveText('nicht gesetzt')
  })

  test('distances follow a resized motif', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await page.getByTestId('guides').click()
    await page.getByTestId('set-floor').click()
    await page.mouse.click(c.x - 300, c.y + 200)
    await expect(page.getByTestId('guide-floor')).toContainText('167 cm')
    await page.getByTestId('guides').click()
    await viewer.widthInput.fill('150')
    await viewer.widthInput.press('Enter')
    await page.getByTestId('guides').click()
    await expect(page.getByTestId('guide-floor')).toContainText('150 cm')
  })
})

test.describe('variants', () => {
  test('keeps size and position per variant and compares them', async ({ page }) => {
    const { viewer } = await setup(page)
    await expect(page.getByTestId('variant-0')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Vergleich' })).toBeDisabled()

    await page.getByTestId('variant-add').click()
    await expect(page.getByTestId('variant-1')).toHaveAttribute('aria-selected', 'true')
    await viewer.widthInput.fill('150')
    await viewer.widthInput.press('Enter')
    await expect(viewer.readout).toContainText('150,0 × 100,0 cm')

    await page.getByTestId('variant-0').click()
    await expect(viewer.readout).toContainText('100,0 × 66,7 cm')
    await page.getByTestId('variant-1').click()
    await expect(viewer.readout).toContainText('150,0 × 100,0 cm')

    await page.getByTestId('variant-add').click()
    await expect(page.getByTestId('variant-2')).toBeVisible()
    await expect(page.getByTestId('variant-add')).toBeDisabled()

    await page.getByRole('button', { name: 'Vergleich' }).click()
    const dialog = page.getByTestId('compare-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('canvas')).toHaveCount(3)
    await expect(dialog).toContainText('Variante 2: 150,0 × 100,0 cm')
    await dialog.getByRole('button', { name: 'Schliessen' }).click()
    await expect(dialog).toHaveCount(0)

    await page.getByTestId('variant-remove').click()
    await expect(page.getByTestId('variant-2')).toHaveCount(0)
  })
})

test.describe('export', () => {
  test('downloads a PNG with the dimensions band', async ({ page }) => {
    await setup(page)
    await page.getByTestId('export').click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-png-download').click(),
    ])
    expect(dl.suggestedFilename()).toMatch(/^wandvorschau-variante-1-\d{4}-\d{2}-\d{2}\.png$/)
    const buf = readFileSync(await dl.path())
    expect(buf.subarray(1, 4).toString()).toBe('PNG')
    expect(buf.readUInt32BE(16)).toBe(1200)
    expect(buf.readUInt32BE(20)).toBeGreaterThan(800)
  })

  test('downloads a one-page PDF with size, distances, date and tolerance note', async ({ page }) => {
    const { c } = await setup(page)
    await page.getByTestId('guides').click()
    await page.getByTestId('set-floor').click()
    await page.mouse.click(c.x - 300, c.y + 200)
    await page.getByTestId('export').click()
    await page.getByTestId('tolerance').fill('3')
    await page.getByTestId('tolerance').press('Enter')

    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-download').click(),
    ])
    expect(dl.suggestedFilename()).toMatch(/\.pdf$/)
    const text = readFileSync(await dl.path()).toString('latin1')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.match(/\/Type \/Page /g)).toHaveLength(1)
    expect(text).toContain('Motiv 100,0 \\327 66,7 cm')
    expect(text).toContain('Abst\\344nde: Boden 167 cm')
    expect(text).toContain('Vorschau, Massangaben ca. \\2613 cm')
    expect(text).toMatch(/Erstellt am \d{2}\.\d{2}\.\d{4}/)
  })

  test('uses a tolerance of 5 cm by default', async ({ page }) => {
    await setup(page)
    await page.getByTestId('export').click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-download').click(),
    ])
    expect(readFileSync(await dl.path()).toString('latin1')).toContain('ca. \\2615 cm')
  })
})
