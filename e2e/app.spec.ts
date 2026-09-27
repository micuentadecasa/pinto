import { expect, test, type Locator, type Page } from '@playwright/test'

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
  const canvas = page.getByLabel(/Reference image/)
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Reference image is not visible')
  await canvas.click({ position: { x: box.width * xFraction, y: box.height * yFraction } })
}

async function touchPointer(canvas: Locator, type: 'pointerdown' | 'pointermove' | 'pointerup', pointerId: number, x: number, y: number) {
  await canvas.dispatchEvent(type, { pointerId, pointerType: 'touch', isPrimary: pointerId === 1, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 })
}

async function expectDescendingPaintPercentages(container: Locator) {
  const percentages = await container.locator('.mix-paints li').evaluateAll(items => items.map(item => Number(item.getAttribute('data-percent'))))
  expect(percentages).toEqual([...percentages].sort((first, second) => second - first))
}

async function selectTone(page: Page, tone: string) {
  await page.getByRole('button', { name: new RegExp(`^${tone}\\b`) }).click()
}

async function expectMixPresentation(page: Page, tone: string) {
  const usedColours = page.getByTestId('used-colours')
  await expect(usedColours).toBeVisible()
  await expect(usedColours.locator('.used-colours-summary > div:first-child > p')).toHaveText(`${tone} · closest match`)
  const selectedMixColour = usedColours.getByTestId('selected-mix-colour')
  await expect(selectedMixColour).toHaveText(/Selected colour#/)
  await expect(selectedMixColour.locator('i')).toBeVisible()
  const [mixColourBackground, selectedToneBackground] = await Promise.all([
    selectedMixColour.locator('i').evaluate(element => getComputedStyle(element).backgroundColor),
    page.locator('.swatch.selected i').evaluate(element => getComputedStyle(element).backgroundColor),
  ])
  expect(mixColourBackground).toBe(selectedToneBackground)
  if (tone === 'Base') {
    await expect(page.locator('.colour')).toBeVisible()
    await expect(page.getByTestId('selected-colour')).toBeVisible()
    await expect(page.getByLabel('Sample name')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save sample' })).toBeVisible()
  } else {
    await expect(page.locator('.colour')).toHaveCount(0)
    await expect(page.getByTestId('selected-colour')).toHaveCount(0)
    await expect(page.getByLabel('Sample name')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save sample' })).toHaveCount(0)
  }
  await expectDescendingPaintPercentages(usedColours)
  const recipes = page.locator('.recipe')
  await expect(recipes).toHaveCount(2)
  for (const recipe of [recipes.nth(0), recipes.nth(1)]) {
    await expect(recipe.locator('.mix-paints i').first()).toBeVisible()
    await expect(recipe.getByTestId('selected-mix-colour')).toHaveText(/Mix colour#/)
    await expect(recipe.getByTestId('selected-mix-colour').locator('i')).toBeVisible()
    await expectDescendingPaintPercentages(recipe)
  }
}

test('generates ordered recipes and restores a stable source sample after reimport', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Photos never leave this device')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Match a colour from a photo' })).toHaveCount(0)
  await expect(page.getByText('Van Gogh basic oils mixer')).toHaveCount(0)
  const camera = page.locator('.app-header .button').first()
  const choose = page.locator('.app-header .button.secondary')
  await expect(camera).toHaveText('Camera')
  await expect(choose).toHaveText('Choose photo')
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  const swatches = page.locator('.swatch')
  await expect(swatches).toHaveCount(5, { timeout: 15000 })
  await expect(swatches.locator('span')).toHaveText(['Highlight', 'Light', 'Base', 'Shadow', 'Deep Shadow'])
  const colours = await swatches.locator('i').evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor.match(/\d+/g)!.map(Number)))
  const lightness = colours.map(labLightness)
  for (let index = 0; index < lightness.length - 1; index++) expect(lightness[index]).toBeGreaterThan(lightness[index + 1])
  expect(new Set(colours.map(colour => colour.join(','))).size).toBe(5)
  const recipes = page.locator('.recipe')
  const usedColours = page.getByTestId('used-colours')
  await expectMixPresentation(page, 'Base')
  await expect(usedColours.locator('.mix-paints li').first()).toBeVisible()
  const usedCircleDiameters = await usedColours.locator('.mix-paints i').evaluateAll(items => items.map(item => item.getBoundingClientRect().width))
  expect(usedCircleDiameters.every(diameter => diameter >= 28 && diameter <= 72)).toBe(true)
  await expect(usedColours.locator('.mix-paints li[data-percent="10"] i')).toHaveCSS('width', '28px')
  for (const tone of ['Highlight', 'Light', 'Base', 'Shadow', 'Deep Shadow']) {
    await selectTone(page, tone)
    await expectMixPresentation(page, tone)
  }
  await expect(page).toHaveScreenshot('family-colour-selection-mobile.png', { fullPage: true })
  await tapCanvas(page, .25, .25)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#b4643c/)
  await tapCanvas(page, .5, .405)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#964b28/)
  const magnifier = page.getByLabel('Selected pixel magnifier')
  await expect(magnifier).toHaveCSS('background-color', 'rgb(150, 75, 40)')
  const [imageBox, magnifierBox] = await Promise.all([page.getByLabel(/Reference image/).boundingBox(), magnifier.boundingBox()])
  expect(imageBox).not.toBeNull()
  expect(magnifierBox).not.toBeNull()
  expect(imageBox!.height).toBeLessThanOrEqual(320)
  expect(magnifierBox!.width).toBeLessThanOrEqual(52)
  expect(Math.abs(magnifierBox!.x + magnifierBox!.width / 2 - (imageBox!.x + imageBox!.width / 2))).toBeLessThan(2)
  expect(Math.abs(magnifierBox!.y + magnifierBox!.height / 2 - (imageBox!.y + imageBox!.height * .405))).toBeLessThan(2)
  await page.getByRole('slider', { name: 'Zoom' }).fill('2')
  await tapCanvas(page, .5, .2)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#cd8255/)
  await tapCanvas(page, .5, .5)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#b4643c/)
  await expect(page.getByTestId('alternative-mixes')).toBeVisible()
  await expect(page.getByTestId('alternative-mixes').locator('.mix-paints i').first()).toBeVisible()
  await page.getByRole('button', { name: 'Save sample' }).click()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(page.getByText(/Mix history/)).toBeVisible()
  await page.getByLabel('Choose reference photo').setInputFiles(otherImage)
  await expect(page.getByRole('status')).toHaveText('Colour family and recipes ready.')
  await expect(swatches).toHaveCount(5)
  await page.getByRole('button', { name: 'Sample 1' }).click()
  await expect(page.getByText('Saved result loaded. Reimport its source image to inspect its location.')).toBeVisible()
  await expect(page.getByLabel(/Saved sample location unavailable/)).toBeVisible()
  await selectTone(page, 'Deep Shadow')
  await expectMixPresentation(page, 'Deep Shadow')
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  await expect(page.getByRole('status')).toHaveText('Colour family and recipes ready.')
  await page.getByRole('button', { name: 'Sample 1' }).click()
  await expect(page.getByText('Saved sample restored on its source image.')).toBeVisible()
  await expect(page.getByLabel('Reference image. Tap to select colour; drag to pan; pinch with two fingers to zoom.')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel(/Reference image/)).toBeVisible()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(swatches).toHaveCount(5)
  await expect(recipes).toHaveCount(2)
})

test('supports bounded one-finger panning and two-finger pinch zoom on the mobile photo viewport', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  await expect(page.locator('.swatch')).toHaveCount(5, { timeout: 15000 })
  const canvas = page.getByLabel('Reference image. Tap to select colour; drag to pan; pinch with two fingers to zoom.')
  const initialColour = await page.getByTestId('selected-colour').textContent()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('Reference image is not visible')
  expect(box.height).toBeLessThanOrEqual(320)

  await touchPointer(canvas, 'pointerdown', 1, box.x + box.width * .35, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerdown', 2, box.x + box.width * .65, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 1, box.x + box.width * .2, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 2, box.x + box.width * .8, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerup', 1, box.x + box.width * .2, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerup', 2, box.x + box.width * .8, box.y + box.height / 2)
  const zoom = page.getByRole('slider', { name: 'Zoom' })
  await expect(zoom).toHaveValue('2')

  await touchPointer(canvas, 'pointerdown', 5, box.x + box.width * .49, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerdown', 6, box.x + box.width * .51, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 5, box.x + box.width * .1, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 6, box.x + box.width * .9, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerup', 5, box.x + box.width * .1, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerup', 6, box.x + box.width * .9, box.y + box.height / 2)
  await expect(zoom).toHaveValue('8')

  const magnifier = page.getByLabel('Selected pixel magnifier')
  const centered = await magnifier.boundingBox()
  expect(centered).not.toBeNull()
  await touchPointer(canvas, 'pointerdown', 3, box.x + box.width / 2, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 3, box.x + box.width * .25, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerup', 3, box.x + box.width * .25, box.y + box.height / 2)
  const panned = await magnifier.boundingBox()
  expect(panned).not.toBeNull()
  expect(panned!.x + panned!.width / 2).toBeLessThan(centered!.x + centered!.width / 2 - box.width * .2)
  expect(panned!.x + panned!.width / 2).toBeGreaterThan(box.x + 20)
  await expect(page.getByTestId('selected-colour')).toHaveText(initialColour!)

  await touchPointer(canvas, 'pointerdown', 4, box.x + box.width / 2, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 4, box.x - box.width * 8, box.y + box.height / 2)
  await touchPointer(canvas, 'pointermove', 4, box.x + box.width * 8, box.y + box.height / 2)
  await touchPointer(canvas, 'pointerup', 4, box.x + box.width * 8, box.y + box.height / 2)
  const limited = await magnifier.boundingBox()
  expect(limited).not.toBeNull()
  expect(Math.abs(limited!.x + limited!.width / 2 - (box.x + box.width * 4))).toBeLessThan(2)
})

test.describe('desktop layout', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false })

  test('keeps selected ingredients above the photo and alternative mixes below it', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
    await expect(page.getByTestId('used-colours')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('alternative-mixes')).toBeVisible()
    await expect(page.getByText('Photos never leave this device')).toHaveCount(0)
    await expect(page.locator('.app-header .button.secondary')).toHaveText('Choose photo')
    await expectMixPresentation(page, 'Base')
    await selectTone(page, 'Shadow')
    await expectMixPresentation(page, 'Shadow')
    await expect(page).toHaveScreenshot('family-colour-selection-desktop.png', { fullPage: true })
    const [usedColours, image, alternatives] = await Promise.all([
      page.getByTestId('used-colours').boundingBox(),
      page.getByLabel(/Reference image/).boundingBox(),
      page.getByTestId('alternative-mixes').boundingBox(),
    ])
    expect(usedColours).not.toBeNull()
    expect(image).not.toBeNull()
    expect(alternatives).not.toBeNull()
    expect(usedColours!.y + usedColours!.height).toBeLessThanOrEqual(image!.y + 1)
    expect(image!.height).toBeLessThanOrEqual(320)
    expect(alternatives!.y).toBeGreaterThan(image!.y + image!.height)
  })
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
