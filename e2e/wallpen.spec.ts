import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

// 1 screen pixel = 1 cm. The motif (3:2) is 100 cm wide and sits in the middle of the view.
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

type Lines = { ceiling?: number; floor?: number; left?: number; right?: number }

// Sets guide lines by tapping the photo; the values are offsets from the view centre in cm.
async function setGuides(page: Page, c: { x: number; y: number }, g: Lines): Promise<void> {
  await page.getByTestId('guides').click()
  const tap = async (kind: string, x: number, y: number): Promise<void> => {
    await page.getByTestId(`set-${kind}`).click()
    await page.mouse.click(x, y)
  }
  if (g.ceiling !== undefined) await tap('ceiling', c.x - 300, c.y + g.ceiling)
  if (g.floor !== undefined) await tap('floor', c.x - 300, c.y + g.floor)
  if (g.left !== undefined) await tap('left', c.x + g.left, c.y + 150)
  if (g.right !== undefined) await tap('right', c.x + g.right, c.y + 150)
}

// A wall 670 cm wide and 500 cm high around the motif.
const WALL: Lines = { ceiling: -250, floor: 250, left: -400, right: 270 }

const storedRules = (page: Page): Promise<unknown> =>
  page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    if (!dbs.some((d) => d.name === 'pixura')) return null
    return new Promise((resolve) => {
      const open = indexedDB.open('pixura')
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('projects')) return resolve(null)
        const q = db.transaction('projects').objectStore('projects').getAll()
        q.onsuccess = () => {
          db.close()
          resolve((q.result[0] as { rules?: unknown } | undefined)?.rules ?? null)
        }
      }
    })
  })

test.describe('wallPen distances', () => {
  test('confirms a motif that keeps all minimum distances', async ({ page }) => {
    const { c } = await setup(page)
    await setGuides(page, c, WALL)
    await expect(page.getByTestId('rules-status')).toContainText('Mindestabstände eingehalten')
    await expect(page.getByTestId('guide-ceiling')).toContainText('min. 40 cm: ok')
    await expect(page.getByTestId('guide-floor')).toContainText('min. 25 cm: ok')
    await expect(page.getByTestId('guide-left')).toContainText('min. 10 cm: ok')
    await page.getByTestId('guides').click()
    await expect(page.getByTestId('rules-status-motif')).toContainText('eingehalten')
  })

  test('warns when the motif is too close to the ceiling', async ({ page }) => {
    const { c } = await setup(page)
    // the motif top is 33.3 cm above the middle; a ceiling 60 cm above it leaves 26.7 cm (needs 40)
    await setGuides(page, c, { ...WALL, ceiling: -60 })
    await expect(page.getByTestId('rules-status')).toContainText('Mindestabstand unterschritten')
    await expect(page.getByTestId('rules-status')).toContainText('Decke (-13,3 cm)')
    await expect(page.getByTestId('guide-ceiling')).toContainText('13,3 cm zu wenig')
    await page.getByTestId('guides').click()
    await expect(page.getByTestId('rules-status-motif')).toContainText('Decke')
  })

  test('shows how large the motif may get at its position', async ({ page }) => {
    const { c } = await setup(page)
    await setGuides(page, c, WALL)
    // printable area x -390..260, y -210..225 around the middle; nearest limit is on the right (260 / 50)
    await expect(page.getByTestId('max-size')).toContainText('520,0 × 346,7 cm')
  })

  test('fits the motif into the printable area', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await setGuides(page, c, WALL)
    await page.getByTestId('fit-max').click()
    // area 650 x 435 cm, motif 3:2 -> limited by the width
    await page.getByTestId('guides').click()
    await expect(viewer.readout).toContainText('650,0 × 433,3 cm')
    await expect(page.getByTestId('rules-status-motif')).toContainText('eingehalten')
  })

  test('the rail and a skirting board shrink the printable area', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await setGuides(page, c, WALL)
    await page.getByTestId('rules-rail').check()
    await page.getByTestId('fit-max').click()
    // floor distance 30 cm -> area 650 x 430, now limited by the height
    await expect(page.getByTestId('guide-floor')).toContainText('min. 30 cm')
    await page.getByTestId('skirting').fill('10')
    await page.getByTestId('skirting').press('Enter')
    await expect(page.getByTestId('guide-floor')).toContainText('min. 40 cm')
    await page.getByTestId('fit-max').click()
    await page.getByTestId('guides').click()
    await expect(viewer.readout).toContainText('630,0 × 420,0 cm')
  })

  test('needs all four lines for fitting and says so', async ({ page }) => {
    const { c } = await setup(page)
    await setGuides(page, c, { ceiling: -250, floor: 250 })
    await page.getByTestId('fit-max').click()
    await expect(page.getByText('alle vier Linien gesetzt sein')).toBeVisible()
    await expect(page.getByTestId('rules-status')).toContainText('Nicht geprüft: Linke Innenecke, Rechte Innenecke')
  })

  test('can be switched off', async ({ page }) => {
    const { c } = await setup(page)
    await setGuides(page, c, { ...WALL, ceiling: -60 })
    await expect(page.getByTestId('rules-status')).toContainText('unterschritten')
    await page.getByTestId('rules-enabled').uncheck()
    await expect(page.getByTestId('rules-status')).toBeHidden()
    await expect(page.getByTestId('guide-ceiling')).not.toContainText('min.')
    await expect(page.getByTestId('fit-max')).toBeDisabled()
  })

  test('puts the result and the on-site checklist into the PDF', async ({ page }) => {
    const { c } = await setup(page)
    await setGuides(page, c, WALL)
    await page.getByTestId('fit-max').click()
    await page.getByTestId('export').click()
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-download').click(),
    ])
    const text = readFileSync(await dl.path()).toString('latin1')
    expect(text).toContain('wallPen: Mindestabst\\344nde eingehalten')
    expect(text).toContain('Vor Ort pr\\374fen: Druckbereich hindernisfrei')
  })

  test('keeps the settings with the project', async ({ page }) => {
    const { c } = await setup(page)
    await setGuides(page, c, WALL)
    await page.getByTestId('rules-rail').check()
    await page.getByTestId('skirting').fill('8')
    await page.getByTestId('skirting').press('Enter')
    await expect
      .poll(() => storedRules(page), { timeout: 20_000 })
      .toEqual({ enabled: true, rail: true, skirtingCm: 8 })

    await page.reload()
    await page.getByTestId('projects').click()
    await page.getByTestId('project-open').click()
    await page.getByTestId('guides').click()
    await expect(page.getByTestId('rules-rail')).toBeChecked()
    await expect(page.getByTestId('skirting')).toHaveValue('8')
    await expect(page.getByTestId('guide-floor')).toContainText('min. 38 cm')
  })
})
