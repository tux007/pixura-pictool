import type { Locator, Page } from '@playwright/test'

export interface ViewState {
  scale: number
  tx: number
  ty: number
}

export class ViewerPage {
  readonly canvas: Locator
  readonly fileInput: Locator
  readonly fitButton: Locator
  readonly alert: Locator

  constructor(readonly page: Page) {
    this.canvas = page.getByTestId('viewport')
    this.fileInput = page.getByTestId('file-input')
    this.fitButton = page.getByRole('button', { name: 'Einpassen' })
    this.alert = page.getByRole('alert')
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
    return this.canvas.evaluate((c: HTMLCanvasElement) => {
      const ctx = c.getContext('2d')
      return ctx ? ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] ?? 0 : 0
    })
  }

  async center(): Promise<{ x: number; y: number }> {
    const box = await this.canvas.boundingBox()
    if (!box) throw new Error('canvas not visible')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
}
