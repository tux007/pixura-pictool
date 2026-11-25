import { expect, test, type Page } from '@playwright/test'
import { ViewerPage } from './pages/viewer-page'

const PHOTO = 'e2e/fixtures/wall.png'

const state = (page: Page, step: string) => page.getByTestId(`step-${step}`)

test.describe('start', () => {
  test('shows a start card and only the first step is open', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await expect(page.getByTestId('start-card')).toBeVisible()
    await expect(page.getByTestId('start-camera')).toBeVisible()
    await expect(page.getByTestId('start-pick')).toBeVisible()
    await expect(page.getByText('Schritt 1 von 5')).toBeVisible()
    await expect(state(page, 'photo')).toHaveAttribute('data-state', 'current')
    for (const s of ['calibrate', 'motif', 'distances', 'export']) {
      await expect(state(page, s)).toHaveAttribute('data-state', 'locked')
    }
    await expect(page.getByTestId('back')).toBeHidden()
    await expect(page.getByTestId('next')).toBeDisabled()
    await expect(page.getByTestId('nav-hint')).toHaveText('Erst ein Foto laden.')
  })

  test('the start card opens the help', async ({ page }) => {
    await new ViewerPage(page).goto()
    await page.getByTestId('start-help').click()
    await expect(page.getByTestId('help-dialog')).toBeVisible()
  })

  test('loading a photo hides the card and unlocks the next step', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(page.getByTestId('start-card')).toBeHidden()
    // step 1 stays the current step until the user moves on; the next one is open
    await expect(state(page, 'photo')).toHaveAttribute('data-state', 'current')
    await expect(state(page, 'calibrate')).toHaveAttribute('data-state', 'todo')
    await expect(page.getByTestId('next')).toBeEnabled()
    await expect(page.getByTestId('next')).toHaveText('Weiter: Kalibrieren ›')
    await expect(page.getByTestId('nav-hint')).toHaveText('')
    await expect(page.getByTestId('pick')).toBeVisible()
  })
})

test.describe('guided flow', () => {
  test('leads through all steps and shows what is missing', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)

    // 2 Kalibrieren: the assistant starts by itself; navigation is locked meanwhile
    await page.getByTestId('next').click()
    await expect(state(page, 'calibrate')).toHaveAttribute('data-state', 'current')
    await expect(page.getByText('Schritt 2 von 5')).toBeVisible()
    await expect(page.getByTestId('calibration-sheet')).toBeVisible()
    await expect(page.getByTestId('back')).toBeDisabled()
    await expect(page.getByTestId('nav-hint')).toContainText('Kalibrierung abschliessen')
    await page.getByTestId('back').click({ force: true })
    await expect(state(page, 'calibrate')).toHaveAttribute('data-state', 'current')

    // cancelling keeps the user in the step, with a way to start again
    await viewer.cancelButton.click()
    await expect(page.getByTestId('calibrate')).toHaveText('Kalibrieren starten')
    await expect(page.getByTestId('next')).toBeDisabled()
    await expect(page.getByTestId('nav-hint')).toContainText('Massstab festlegen')
    // a locked step can be tapped; it stays locked and says why
    await state(page, 'motif').click({ force: true })
    await expect(state(page, 'motif')).toHaveAttribute('data-state', 'locked')
    await expect(page.getByTestId('nav-hint')).toContainText('Massstab')

    await page.getByTestId('calibrate').click()
    await page.getByTestId('mode-linear').click()
    const c = await viewer.center()
    await page.mouse.click(c.x - 150, c.y - 100)
    await page.mouse.click(c.x + 150, c.y - 100)
    await viewer.distanceInput.fill('300')
    await viewer.applyButton.click()
    await expect(state(page, 'calibrate')).toHaveAttribute('data-state', 'current')
    await expect(page.getByTestId('calibrate')).toHaveText('Neu kalibrieren')
    await expect(page.getByTestId('next')).toBeEnabled()

    // 3 Motiv
    await page.getByTestId('next').click()
    await expect(state(page, 'motif')).toHaveAttribute('data-state', 'current')
    await expect(page.getByTestId('motif')).toHaveText('Motiv wählen')
    await expect(page.getByTestId('step-hint')).toContainText('Wähle das Motiv')
    await expect(page.getByTestId('next')).toBeDisabled()
    await expect(page.getByTestId('nav-hint')).toContainText('Motiv laden')
    await viewer.motifInput.setInputFiles(PHOTO)
    await expect(viewer.readout).toBeVisible()
    await expect(page.getByTestId('motif')).toHaveText('Anderes Motiv wählen')
    await expect(page.getByTestId('step-hint')).toContainText('Optional')
    await expect(page.getByTestId('next')).toBeEnabled()

    // 4 Abstände: all four lines are needed before the export
    await page.getByTestId('next').click()
    await expect(state(page, 'distances')).toHaveAttribute('data-state', 'current')
    await expect(page.getByTestId('step-hint')).toContainText('Noch 4 von 4 Linien offen')
    await expect(page.getByTestId('next')).toBeDisabled()
    await expect(page.getByTestId('nav-hint')).toContainText('vier Linien')
    for (const [i, [kind, dx, dy]] of (
      [
        ['ceiling', -300, -200],
        ['floor', -300, 200],
        ['left', -300, 100],
        ['right', 250, 100],
      ] as const
    ).entries()) {
      await page.getByTestId(`set-${kind}`).click()
      await page.mouse.click(c.x + dx, c.y + dy)
      if (i < 3) await expect(page.getByTestId('step-hint')).toContainText(`Noch ${3 - i} von 4 Linien offen`)
    }
    await expect(page.getByTestId('step-hint')).toContainText('Alle Linien sind gesetzt')
    await expect(page.getByTestId('next')).toBeEnabled()
    await expect(state(page, 'export')).toHaveAttribute('data-state', 'todo')

    // 5 Export: last step, no "next"
    await page.getByTestId('next').click()
    await expect(state(page, 'export')).toHaveAttribute('data-state', 'current')
    await expect(page.getByText('Schritt 5 von 5')).toBeVisible()
    await expect(page.getByTestId('next')).toBeHidden()
    await expect(page.getByTestId('back')).toHaveText('‹ Zurück: Abstände')
    await expect(page.getByTestId('export-png-download')).toBeVisible()

    // back is always possible and finished steps are marked
    await page.getByTestId('back').click()
    await expect(state(page, 'distances')).toHaveAttribute('data-state', 'current')
    await state(page, 'photo').click()
    await expect(state(page, 'photo')).toHaveAttribute('data-state', 'current')
    for (const s of ['calibrate', 'motif', 'distances']) {
      await expect(state(page, s)).toHaveAttribute('data-state', 'done')
    }
    await expect(state(page, 'export')).toHaveAttribute('data-state', 'todo')
  })

  test('warns on the export step when a minimum distance is not kept', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    const c = await viewer.calibrateLinear()
    await viewer.addMotif(PHOTO, 100)
    // ceiling only 60 cm above the middle: 26.7 cm to the motif, 40 cm needed
    await viewer.setGuides(c, { ceiling: -60, floor: 250, left: -400, right: 270 })
    await expect(page.getByTestId('step-hint')).toContainText('Achtung')
    await page.getByTestId('next').click()
    await expect(page.getByTestId('step-hint')).toContainText('unterschreitet einen wallPen-Mindestabstand')
    await expect(page.getByTestId('export-png-download')).toBeEnabled()
  })

  test('removing the motif sends the user back to the motif step', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    const c = await viewer.calibrateLinear()
    await viewer.addMotif(PHOTO, 100)
    await viewer.setGuides(c, { ceiling: -250, floor: 250, left: -400, right: 270 })
    await page.getByTestId('next').click()
    await expect(state(page, 'export')).toHaveAttribute('data-state', 'current')
    await viewer.goTo('motif')
    await page.getByTestId('variant-remove').click()
    await expect(state(page, 'motif')).toHaveAttribute('data-state', 'current')
    await expect(state(page, 'distances')).toHaveAttribute('data-state', 'locked')
    await expect(page.getByTestId('motif')).toHaveText('Motiv wählen')
  })

  test('recalibrating resets the guide lines and the later steps lock again', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    const c = await viewer.calibrateLinear()
    await viewer.addMotif(PHOTO, 100)
    await viewer.setGuides(c, { ceiling: -250, floor: 250, left: -400, right: 270 })
    await expect(state(page, 'export')).toHaveAttribute('data-state', 'todo')
    await viewer.goTo('calibrate')
    await page.getByTestId('calibrate').click()
    await page.getByTestId('mode-linear').click()
    const d = await viewer.center()
    await page.mouse.click(d.x - 100, d.y - 100)
    await page.mouse.click(d.x + 100, d.y - 100)
    await viewer.distanceInput.fill('200')
    await viewer.applyButton.click()
    // a plain distance cannot carry the wall lines over
    await expect(page.getByText('Hilfslinien wurden zurückgesetzt')).toBeVisible()
    await expect(state(page, 'export')).toHaveAttribute('data-state', 'locked')
    await expect(state(page, 'distances')).toHaveAttribute('data-state', 'todo')
  })
})

test.describe('small screens', () => {
  test.use({ viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, hasTouch: true })

  test('shows the current step name and lets the panel fold away', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    // only the current step shows its label, the others are numbers
    await expect(state(page, 'photo').locator('.lbl')).toBeVisible()
    await expect(state(page, 'calibrate').locator('.lbl')).toBeHidden()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    await viewer.calibrateButton.click()
    await page.getByTestId('mode-linear').click()
    const c = await viewer.center()
    await page.mouse.click(c.x - 100, c.y - 100)
    await page.mouse.click(c.x + 60, c.y - 100)
    await viewer.distanceInput.fill('150')
    await viewer.applyButton.click()
    await viewer.addMotif(PHOTO, 80)

    const toggle = page.locator('[data-testid=sheet-toggle]:visible')
    await expect(viewer.readout).toBeVisible()
    await toggle.click()
    await expect(viewer.readout).toBeHidden()
    await expect(toggle).toHaveText('Ausklappen')
    await toggle.click()
    await expect(viewer.readout).toBeVisible()
  })

  test('shows a dismissible hint that the device is small', async ({ page }) => {
    await new ViewerPage(page).goto()
    const note = page.getByTestId('device-note')
    await expect(note).toBeVisible()
    await expect(note).toContainText('Tablets ab ca. 10 Zoll')
    // not a block: the buttons still work
    await expect(page.getByTestId('start-pick')).toBeEnabled()
    await page.getByTestId('device-note-dismiss').click()
    await expect(note).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('start-card')).toBeVisible()
    await expect(page.getByTestId('device-note')).toHaveCount(0)
  })

  test('the calibration window can be folded away to reach the photo', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    await viewer.calibrateButton.click()
    await page.getByTestId('mode-linear').click()
    await expect(viewer.distanceInput).toBeVisible()
    const toggle = page.locator('[data-testid=sheet-toggle]:visible')
    await toggle.click()
    await expect(viewer.distanceInput).toBeHidden()
    // the markers can be placed in the photo, then the window comes back
    const c = await viewer.center()
    await page.mouse.click(c.x - 80, c.y + 150)
    await page.mouse.click(c.x + 60, c.y + 150)
    await toggle.click()
    await expect(viewer.distanceInput).toBeVisible()
    await expect(viewer.applyButton).toBeEnabled()
  })

  test('the long hint text can be hidden', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    const hint = page.getByTestId('step-hint')
    const toggle = page.getByTestId('hint-toggle')
    await expect(hint).toBeVisible()
    await toggle.click()
    await expect(hint).toBeHidden()
    await expect(toggle).toHaveText('Hinweis anzeigen')
    await toggle.click()
    await expect(hint).toBeVisible()
  })

  test('an error message can be closed', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') })
    await expect(viewer.alert).toContainText('kein Bild')
    await page.getByTestId('banner-close').click()
    await expect(viewer.alert).toBeHidden()
  })

  test('wide screens: panels fold away too, but there is no hint button or device note', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    await viewer.calibrateLinear()
    await viewer.addMotif(PHOTO, 100)
    // the docked panel can be folded so that corners at the photo edge are reachable
    const toggle = page.locator('[data-testid=sheet-toggle]:visible')
    await expect(toggle).toHaveCount(1)
    await toggle.click()
    await expect(viewer.readout).toBeHidden()
    await toggle.click()
    await expect(page.getByTestId('hint-toggle')).toBeHidden()
    await expect(page.getByTestId('device-note')).toHaveCount(0)
    await expect(viewer.readout).toBeVisible()
  })
})

test.describe('screen sizes', () => {
  test.describe('iPad Air', () => {
    test.use({ viewport: { width: 820, height: 1180 }, screen: { width: 820, height: 1180 }, hasTouch: true })

    test('is a suitable device: no hint on the start card', async ({ page }) => {
      await new ViewerPage(page).goto()
      await expect(page.getByTestId('start-card')).toBeVisible()
      await expect(page.getByTestId('device-note')).toHaveCount(0)
    })
  })

  test.describe('iPad mini', () => {
    test.use({ viewport: { width: 744, height: 1133 }, screen: { width: 744, height: 1133 }, hasTouch: true })

    test('is too small: shows the hint', async ({ page }) => {
      await new ViewerPage(page).goto()
      await expect(page.getByTestId('device-note')).toBeVisible()
    })
  })

  test.describe('phone in landscape', () => {
    test.use({ viewport: { width: 844, height: 390 }, screen: { width: 844, height: 390 }, hasTouch: true })

    test('keeps room for the photo: panels start folded and the hint is off', async ({ page }) => {
      const viewer = new ViewerPage(page)
      await viewer.goto()
      await viewer.loadPhoto(PHOTO)
      await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
      // bars are slim: the photo area keeps a usable height
      const box = await viewer.canvas.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThan(190)
      await expect(page.getByTestId('step-hint')).toBeHidden()
      await expect(page.getByTestId('hint-toggle')).toHaveText('Hinweis anzeigen')

      await viewer.calibrateButton.click()
      const toggle = page.locator('[data-testid=sheet-toggle]:visible')
      await expect(toggle).toHaveText('Ausklappen')
      await expect(page.getByLabel('Wandbreite')).toBeHidden()
      await toggle.click()
      await expect(page.getByLabel('Wandbreite')).toBeVisible()
    })
  })
})

test.describe('menu', () => {
  test('opens the projects and the help and closes again', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await page.getByTestId('menu').click()
    await expect(page.getByTestId('menu-projects')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('menu-projects')).toBeHidden()

    await viewer.openProjects()
    await expect(page.getByText('Noch keine gespeicherten Projekte.')).toBeVisible()
    await page.getByTestId('projects-close').click()
    await expect(page.getByText('Noch keine gespeicherten Projekte.')).toBeHidden()

    await page.getByTestId('menu').click()
    await page.getByTestId('menu-help').click()
    await expect(page.getByTestId('help-dialog')).toBeVisible()
  })

  test('lists the last projects on the start card', async ({ page }) => {
    const viewer = new ViewerPage(page)
    await viewer.goto()
    await viewer.loadPhoto(PHOTO)
    await expect(viewer.canvas).toHaveAttribute('data-scale', /.+/)
    // wait until the project itself is stored (the database also exists before the first save)
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<number>((resolve) => {
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
              }),
          ),
        { timeout: 20_000 },
      )
      .toBe(1)
    await page.reload()
    await expect(page.getByTestId('start-open')).toHaveCount(1, { timeout: 20_000 })
    await page.getByTestId('start-open').click()
    await expect(page.getByTestId('start-card')).toBeHidden()
    await expect(state(page, 'photo')).toHaveAttribute('data-state', 'done')
    // not calibrated yet: continue with the calibration
    await expect(state(page, 'calibrate')).toHaveAttribute('data-state', 'current')
  })
})
