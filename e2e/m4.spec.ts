import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { ViewerPage, type Lines } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

// 1 screen pixel = 1 cm, motif 100 cm wide in the middle of the view, all four lines set
const WALL: Lines = { ceiling: -200, floor: 200, left: -300, right: 250 }

async function setup(page: Page): Promise<{ viewer: ViewerPage; c: { x: number; y: number } }> {
  const viewer = new ViewerPage(page)
  await viewer.goto()
  await viewer.loadPhoto(PHOTO)
  await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
  const c = await viewer.calibrateLinear()
  await viewer.addMotif(PHOTO, 100)
  await expect(viewer.readout).toContainText('100,0 × 66,7 cm')
  return { viewer, c }
}

test.describe('guide lines', () => {
  test('shows the distances from the motif to floor, ceiling and wall edges', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await viewer.setGuides(c, WALL)

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
    await viewer.setGuides(c, { floor: 200 })
    await expect(page.getByTestId('guide-floor')).toContainText('167 cm')
    await viewer.goTo('motif')
    await viewer.widthInput.fill('150')
    await viewer.widthInput.press('Enter')
    await viewer.goTo('distances')
    await expect(page.getByTestId('guide-floor')).toContainText('150 cm')
  })
})

test.describe('variants', () => {
  test('keeps size and position per variant and compares them', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await expect(page.getByTestId('variant-0')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('compare')).toBeHidden()

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

    // the comparison lives on the export step
    await viewer.setGuides(c, WALL)
    await viewer.goTo('export')
    await page.getByTestId('compare').click()
    const dialog = page.getByTestId('compare-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('canvas')).toHaveCount(3)
    await expect(dialog).toContainText('Variante 2: 150,0 × 100,0 cm')
    await dialog.getByRole('button', { name: 'Schliessen' }).click()
    await expect(dialog).toHaveCount(0)

    await viewer.goTo('motif')
    await page.getByTestId('variant-remove').click()
    await expect(page.getByTestId('variant-2')).toHaveCount(0)
  })

  test('variants are optional: the flow works with a single motif', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await viewer.setGuides(c, WALL)
    await viewer.goTo('export')
    await expect(page.getByTestId('export-png-download')).toBeEnabled()
    await expect(page.getByTestId('compare')).toBeHidden()
  })
})

test.describe('export', () => {
  test('downloads a PNG with the dimensions band', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await viewer.setGuides(c, WALL)
    await viewer.goTo('export')
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
    const { viewer, c } = await setup(page)
    await viewer.setGuides(c, WALL)
    await viewer.goTo('export')
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
    const { viewer, c } = await setup(page)
    await viewer.setGuides(c, WALL)
    await viewer.goTo('export')
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-download').click(),
    ])
    expect(readFileSync(await dl.path()).toString('latin1')).toContain('ca. \\2615 cm')
  })
})
