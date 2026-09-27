import { expect, test, type Page } from '@playwright/test'

const tonalImage = 'e2e/assets/tones.png'
const otherImage = 'e2e/assets/other.png'
const cataloguePaint = /\b(105|268|270|393|366|504|535|619|409|701)\b.*:\s*(?:[1-9]\d?|100)%/

function labLightness([red, green, blue]: number[]) {
  const linear = (value: number) => {
    const channel = value / 255
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  }
  const y = linear(red) * .2126 + linear(green) * .7152 + linear(blue) * .0722
  return 116 * (y > .008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116) - 16
}

async function tapCanvas(page: Page, xFraction: number, yFraction: number) {
  const box = await page.getByLabel(/Reference image/).boundingBox()
  if (!box) throw new Error('Reference image is not visible')
  await page.mouse.click(box.x + box.width * xFraction, box.y + box.height * yFraction)
}

test('generates ordered recipes and restores a stable source sample after reimport', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Photos never leave this device')).toBeVisible()
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  const swatches = page.locator('.swatch')
  await expect(swatches).toHaveCount(5, { timeout: 15000 })
  await expect(swatches.locator('span')).toHaveText(['Highlight', 'Light', 'Base', 'Shadow', 'Deep Shadow'])
  const colours = await swatches.locator('i').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor.match(/\d+/g)!.map(Number)))
  const lightness = colours.map(labLightness)
  for (let index = 0; index < lightness.length - 1; index++) expect(lightness[index]).toBeGreaterThan(lightness[index + 1])
  expect(new Set(colours.map(colour => colour.join(','))).size).toBe(5)
  const recipes = page.locator('.recipe')
  await expect(recipes).toHaveCount(2)
  for (const recipe of [recipes.nth(0), recipes.nth(1)]) {
    const parts = await recipe.locator('span').allTextContents()
    expect(parts.some(part => cataloguePaint.test(part))).toBe(true)
  }
  await tapCanvas(page, .25, .25)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#b4643c/)
  await page.getByLabel('Zoom').fill('2')
  await tapCanvas(page, .5, .2)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#cd8255/)
  await tapCanvas(page, .5, .5)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#b4643c/)
  await page.getByRole('button', { name: 'Save sample' }).click()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(page.getByText(/Mix history/)).toBeVisible()
  await page.getByLabel('Choose reference photo').setInputFiles(otherImage)
  await expect(page.getByRole('status')).toHaveText('Colour family and recipes ready.')
  await expect(swatches).toHaveCount(5)
  await page.getByRole('button', { name: 'Sample 1' }).click()
  await expect(page.getByText('Saved result loaded. Reimport its source image to inspect its location.')).toBeVisible()
  await expect(page.getByLabel(/Saved sample location unavailable/)).toBeVisible()
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  await expect(page.getByRole('status')).toHaveText('Colour family and recipes ready.')
  await page.getByRole('button', { name: 'Sample 1' }).click()
  await expect(page.getByText('Saved sample restored on its source image.')).toBeVisible()
  await expect(page.getByLabel('Reference image. Tap to select colour; drag to pan.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel(/Reference image/)).toBeVisible()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(swatches).toHaveCount(5)
  await expect(recipes).toHaveCount(2)
})

test('does not publish a stale analysis after selecting another photo', async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    let requestCount = 0
    let releaseDeferred = () => { throw new Error('No analysis was deferred') }
    class DeferredWorker {
      worker: Worker
      deferred?: [unknown, Transferable[] | undefined]
      onmessage: ((event: MessageEvent) => void) | null = null
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        this.worker = new NativeWorker(scriptURL, options)
        this.worker.onmessage = event => this.onmessage?.(event)
      }
      postMessage(message: unknown, transfer?: Transferable[]) {
        requestCount += 1
        if (requestCount === 2) {
          this.deferred = [message, transfer]
          releaseDeferred = () => {
            if (!this.deferred) throw new Error('No analysis was deferred')
            this.worker.postMessage(...this.deferred)
            this.deferred = undefined
          }
          return
        }
        this.worker.postMessage(message, transfer)
      }
      terminate() { this.worker.terminate() }
    }
    window.Worker = DeferredWorker as unknown as typeof Worker
    ;(window as Window & { releaseDeferredAnalysis?: () => void }).releaseDeferredAnalysis = () => releaseDeferred()
  })
  await page.goto('/')
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  await expect(page.locator('.swatch')).toHaveCount(5, { timeout: 15000 })
  await tapCanvas(page, .25, .25)
  await page.getByLabel('Choose reference photo').setInputFiles(otherImage)
  await expect(page.getByRole('status')).toHaveText('Colour family and recipes ready.')
  const currentColour = await page.getByTestId('selected-colour').textContent()
  expect(currentColour).not.toBeNull()
  expect(currentColour).not.toMatch(/^#b4643c/)
  await page.evaluate(() => (window as Window & { releaseDeferredAnalysis?: () => void }).releaseDeferredAnalysis?.())
  await page.waitForTimeout(500)
  await expect(page.getByTestId('selected-colour')).toHaveText(currentColour!)
})

test('does not publish a stale comparison after selecting another tone', async ({ page }) => {
  await page.addInitScript(() => {
    const nativeCreateImageBitmap = window.createImageBitmap.bind(window)
    let calls = 0
    window.createImageBitmap = async (...arguments_: Parameters<typeof createImageBitmap>) => {
      const bitmap = await nativeCreateImageBitmap(...arguments_)
      if (++calls === 2) await new Promise(resolve => window.setTimeout(resolve, 500))
      return bitmap
    }
  })
  await page.goto('/')
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  await expect(page.locator('.swatch')).toHaveCount(5, { timeout: 15000 })
  await page.getByLabel('Check my mix photo').setInputFiles(otherImage)
  await page.getByRole('button', { name: 'Highlight' }).click()
  await page.waitForTimeout(750)
  await expect(page.getByRole('status')).toHaveText('Colour family and recipes ready.')
})
