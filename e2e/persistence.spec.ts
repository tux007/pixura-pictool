import { expect, test, type Page } from '@playwright/test'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

// 1 screen pixel = 1 cm, motif 100 cm wide in the middle of the view
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

// Counts stored projects without creating the database as a side effect.
const stored = (page: Page): Promise<number> =>
  page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    if (!dbs.some((d) => d.name === 'pixura')) return 0
    return new Promise<number>((resolve) => {
      const open = indexedDB.open('pixura')
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('projects')) return resolve(0)
        const q = db.transaction('projects').objectStore('projects').count()
        q.onsuccess = () => {
          db.close()
          resolve(q.result)
        }
      }
    })
  })

const storedTolerance = (page: Page): Promise<number | null> =>
  page.evaluate(async () => {
    // never open a database that does not exist yet: that would create it empty
    const dbs = await indexedDB.databases()
    if (!dbs.some((d) => d.name === 'pixura')) return null
    return new Promise<number | null>((resolve) => {
      const open = indexedDB.open('pixura')
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('projects')) {
          db.close()
          return resolve(null)
        }
        const q = db.transaction('projects').objectStore('projects').getAll()
        q.onsuccess = () => {
          db.close()
          resolve((q.result[0] as { toleranceCm?: number } | undefined)?.toleranceCm ?? null)
        }
      }
    })
  })

const rows = (page: Page) => page.getByTestId('project-row')

const WALL = { ceiling: -200, floor: 200, left: -300, right: 250 }

test.describe('projects', () => {
  test('autosaves and reopens a project after a reload, also offline', async ({ page, context }) => {
    const { viewer } = await setup(page)
    await expect.poll(() => stored(page), { timeout: 20_000 }).toBe(1)

    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await context.setOffline(true)
    await page.reload()

    await viewer.openProjects()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('1 Variante')
    await page.getByTestId('project-open').click()

    await expect(viewer.canvas).toHaveAttribute('data-calibration', 'linear')
    await expect(viewer.canvas).toHaveAttribute('data-px-per-cm', /.+/)
    // a motif but no guide lines yet: the project continues on the distances step
    await expect(page.getByTestId('step-distances')).toHaveAttribute('data-state', 'current')
    await viewer.goTo('motif')
    await expect(viewer.readout).toContainText('100,0 × 66,7 cm')
    await expect.poll(() => viewer.motifPixels()).toBeGreaterThan(1000)
  })

  test('keeps guide lines and the tolerance with the project', async ({ page }) => {
    const { viewer, c } = await setup(page)
    await viewer.setGuides(c, WALL)
    await expect(page.getByTestId('guide-floor')).toContainText('167 cm')
    await viewer.goTo('export')
    await page.getByTestId('tolerance').fill('2,5')
    await page.getByTestId('tolerance').press('Enter')
    await expect.poll(() => storedTolerance(page), { timeout: 20_000 }).toBe(2.5)

    await page.reload()
    await viewer.openProjects()
    await page.getByTestId('project-open').click()
    // everything is done: the project opens on the export step
    await expect(page.getByTestId('step-export')).toHaveAttribute('data-state', 'current')
    await expect(page.getByTestId('tolerance')).toHaveValue('2,5')
    await viewer.goTo('distances')
    await expect(page.getByTestId('guide-floor')).toContainText('167 cm')
  })

  test('keeps a whole-wall calibration together with its guide lines', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    await viewer.calibrateWall(400, 300)
    await viewer.addMotif(PHOTO, 100)
    await expect.poll(() => stored(page), { timeout: 20_000 }).toBe(1)

    await page.reload()
    await viewer.openProjects()
    await page.getByTestId('project-open').click()
    // calibrated, motif and all four lines: the project opens on the export step
    await expect(page.getByTestId('step-export')).toHaveAttribute('data-state', 'current')
    await viewer.goTo('distances')
    await expect(page.getByTestId('guide-ceiling')).toContainText('Abstand 117 cm')
    await expect(page.getByTestId('step-hint')).toContainText('aus der Wandkalibrierung')
  })

  test('duplicates and deletes projects', async ({ page }) => {
    const { viewer } = await setup(page)
    await expect.poll(() => stored(page), { timeout: 20_000 }).toBe(1)
    await viewer.openProjects()
    await expect(rows(page)).toHaveCount(1)

    await page.getByTestId('project-duplicate').click()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByText('(Kopie)')).toBeVisible()

    const del = rows(page).last().getByTestId('project-delete')
    await del.click()
    await expect(del).toHaveText('Wirklich löschen?')
    await expect(rows(page)).toHaveCount(2)
    await del.click()
    await expect(rows(page)).toHaveCount(1)
    await expect.poll(() => stored(page), { timeout: 20_000 }).toBe(1)
  })

  test('deletes all local data after a second confirmation', async ({ page }) => {
    const { viewer } = await setup(page)
    await expect.poll(() => stored(page), { timeout: 20_000 }).toBe(1)
    await viewer.openProjects()
    await page.getByTestId('clear-all').click()
    await expect(page.getByTestId('clear-all')).toHaveText('Wirklich alles löschen?')
    await page.getByTestId('clear-all').click()

    await page.waitForLoadState('load')
    await expect(page.getByTestId('start-card')).toBeVisible()
    expect(await stored(page)).toBe(0)
    await viewer.openProjects()
    await expect(page.getByText('Noch keine gespeicherten Projekte.')).toBeVisible()
  })

  test('a deleted open project is not saved again', async ({ page }) => {
    const { viewer } = await setup(page)
    await expect.poll(() => stored(page), { timeout: 20_000 }).toBe(1)
    await viewer.openProjects()
    await page.getByTestId('project-delete').click()
    await page.getByTestId('project-delete').click()
    await expect(page.getByText('Noch keine gespeicherten Projekte.')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(await stored(page)).toBe(0)
  })
})

test.describe('help', () => {
  test('explains how to photograph the wall', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('menu').click()
    await page.getByTestId('menu-help').click()
    const dialog = page.getByTestId('help-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('So fotografierst du die Wand')
    await expect(dialog).toContainText('Ultraweitwinkel')
    await expect(dialog).toContainText('Laser')
    await dialog.getByRole('button', { name: 'Schliessen' }).click()
    await expect(dialog).toHaveCount(0)
  })
})
