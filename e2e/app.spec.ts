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
