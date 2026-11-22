import { expect, test } from '@playwright/test'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

test.describe('viewer', () => {
  test('shows a loaded photo', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-ready', 'true')
    await expect(page.getByText('1200 × 800 px')).toBeVisible()
    await expect.poll(() => viewer.centerAlpha()).toBe(255)
  })

  test('zooms with the mouse wheel', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    const before = await viewer.view()
    const c = await viewer.center()
    await page.mouse.move(c.x, c.y)
    await page.mouse.wheel(0, -400)
    await expect.poll(async () => (await viewer.view()).scale).toBeGreaterThan(before.scale)
  })

  test('pans by dragging and fits again on button', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    const before = await viewer.view()
    const c = await viewer.center()
    await page.mouse.move(c.x, c.y)
    await page.mouse.down()
    await page.mouse.move(c.x + 60, c.y + 30, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await viewer.view()).tx).toBeCloseTo(before.tx + 60, 0)
    await viewer.fitButton.click()
    await expect.poll(async () => (await viewer.view()).tx).toBeCloseTo(before.tx, 0)
  })

  test('rejects files that are not images', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(viewer.alert).toContainText('kein Bild')
  })

  test('works offline after the first load', async ({ page, context }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Foto wählen' })).toBeVisible()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-ready', 'true')
  })
})
