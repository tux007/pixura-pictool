import type { Locator, Page } from '@playwright/test'

export interface ViewState {
  scale: number
  tx: number
  ty: number
}

export type StepName = 'photo' | 'calibrate' | 'motif' | 'distances' | 'export'

// Guide lines as offsets from the view centre in cm (1 screen pixel = 1 cm after calibrateLinear).
export interface Lines {
  ceiling?: number
  floor?: number
  left?: number
  right?: number
}

export class ViewerPage {
  readonly canvas: Locator
  readonly fileInput: Locator
  readonly fitButton: Locator
  readonly alert: Locator
  readonly calibrateButton: Locator
  readonly motifInput: Locator
  readonly distanceInput: Locator
  readonly applyButton: Locator
  readonly cancelButton: Locator
  readonly widthInput: Locator
  readonly heightInput: Locator
  readonly readout: Locator

  constructor(readonly page: Page) {
    // entering the calibration step starts the assistant
    this.calibrateButton = page.getByTestId('step-calibrate')
    this.motifInput = page.getByTestId('motif-input')
    this.distanceInput = page.getByLabel('Echte Distanz')
    this.applyButton = page.getByRole('button', { name: 'Übernehmen' })
    this.cancelButton = page.getByRole('button', { name: 'Abbrechen' })
    this.widthInput = page.getByTestId('width')
    this.heightInput = page.getByTestId('height')
    this.readout = page.getByTestId('readout')
    this.canvas = page.getByTestId('viewport')
    this.fileInput = page.getByTestId('file-input')
    this.fitButton = page.getByRole('button', { name: 'Einpassen' })
    this.alert = page.getByRole('alert')
  }

  async goTo(step: StepName): Promise<void> {
    await this.page.getByTestId(`step-${step}`).click()
  }

  async openProjects(): Promise<void> {
    await this.page.getByTestId('menu').click()
    await this.page.getByTestId('menu-projects').click()
  }

  // The four corners of the "wall" are a screen rectangle of widthCm x heightCm pixels around the
  // view centre, so afterwards 1 screen pixel = 1 cm and wall coordinates start at the rectangle's
  // top-left corner. The guide lines are set from the wall.
  async calibrateWall(widthCm = 400, heightCm = 300): Promise<{ x: number; y: number }> {
    await this.calibrateButton.click()
    const c = await this.center()
    const hw = widthCm / 2
    const hh = heightCm / 2
    for (const [dx, dy] of [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const) {
      await this.page.mouse.click(c.x + dx, c.y + dy)
    }
    await this.page.getByLabel('Wandbreite').fill(String(widthCm))
    await this.page.getByLabel('Wandhöhe').fill(String(heightCm))
    await this.applyButton.click()
    return c
  }

  // Two taps 300 screen px apart for 300 cm: afterwards 1 screen pixel = 1 cm.
  async calibrateLinear(distance = '300'): Promise<{ x: number; y: number }> {
    await this.calibrateButton.click()
    await this.page.getByTestId('mode-linear').click()
    const c = await this.center()
    await this.page.mouse.click(c.x - 150, c.y - 100)
    await this.page.mouse.click(c.x + 150, c.y - 100)
    await this.distanceInput.fill(distance)
    await this.applyButton.click()
    return c
  }

  async addMotif(file: string | { name: string; mimeType: string; buffer: Buffer }, widthCm?: number): Promise<void> {
    await this.goTo('motif')
    await this.motifInput.setInputFiles(file)
    if (widthCm !== undefined) {
      await this.widthInput.fill(String(widthCm))
      await this.widthInput.press('Enter')
    }
  }

  async setGuides(c: { x: number; y: number }, g: Lines): Promise<void> {
    await this.goTo('distances')
    const tap = async (kind: string, x: number, y: number): Promise<void> => {
      await this.page.getByTestId(`set-${kind}`).click()
      await this.page.mouse.click(x, y)
    }
    if (g.ceiling !== undefined) await tap('ceiling', c.x - 300, c.y + g.ceiling)
    if (g.floor !== undefined) await tap('floor', c.x - 300, c.y + g.floor)
    if (g.left !== undefined) await tap('left', c.x + g.left, c.y + 150)
    if (g.right !== undefined) await tap('right', c.x + g.right, c.y + 150)
  }

  async goto(): Promise<void> {
    await this.page.goto('/')
    await this.page.waitForLoadState('networkidle')
  }

  async loadPhoto(file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
    await this.fileInput.setInputFiles(file)
  }

  async view(): Promise<ViewState> {
    const attr = async (n: string): Promise<number> => Number(await this.canvas.getAttribute(`data-${n}`))
    return { scale: await attr('scale'), tx: await attr('tx'), ty: await attr('ty') }
  }

  async centerAlpha(): Promise<number> {
    return this.page.getByTestId('wall-canvas').evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')
      return ctx ? ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] ?? 0 : 0
    })
  }

  // Number of non-transparent pixels the WebGL motif pass produced.
  async motifPixels(): Promise<number> {
    return this.page.getByTestId('motif-canvas').evaluate((c: HTMLCanvasElement) => {
      const t = document.createElement('canvas')
      t.width = c.width
      t.height = c.height
      const ctx = t.getContext('2d')
      if (!ctx) return 0
      ctx.drawImage(c, 0, 0)
      const d = ctx.getImageData(0, 0, t.width, t.height).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 0) n++
      return n
    })
  }

  async center(): Promise<{ x: number; y: number }> {
    const box = await this.canvas.boundingBox()
    if (!box) throw new Error('canvas not visible')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
}
