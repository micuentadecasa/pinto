import { expect, test, type Page } from '@playwright/test'

const tonalImage = 'e2e/assets/tones.png'

async function tapCanvas(page: Page, xFraction: number, yFraction: number) {
  const box = await page.getByLabel(/Reference image/).boundingBox()
  if (!box) throw new Error('Reference image is not visible')
  await page.mouse.click(box.x + box.width * xFraction, box.y + box.height * yFraction)
}

test('generates a complete family and preserves a source sample across zoom', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Photos never leave this device')).toBeVisible()
  await page.getByLabel('Choose reference photo').setInputFiles(tonalImage)
  const swatches = page.locator('.swatch')
  await expect(swatches).toHaveCount(5, { timeout: 15000 })
  await expect(swatches.locator('span')).toHaveText(['Highlight', 'Light', 'Base', 'Shadow', 'Deep Shadow'])
  const recipes = page.locator('.recipe')
  await expect(recipes).toHaveCount(2)
  await expect(recipes.nth(0)).toContainText(/Simple · ΔE \d/)
  await expect(recipes.nth(1)).toContainText(/Complex · ΔE \d/)
  await tapCanvas(page, .25, .25)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#b4643c/)
  await page.getByLabel('Zoom').fill('2')
  await tapCanvas(page, .5, .5)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#b4643c/)
  await page.getByRole('button', { name: 'Save sample' }).click()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(page.getByText(/Mix history/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel(/Reference image/)).toBeVisible()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(swatches).toHaveCount(5)
  await expect(recipes).toHaveCount(2)
})
