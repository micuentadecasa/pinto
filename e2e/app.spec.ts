import { expect, test, type Page } from '@playwright/test'

const stripedImage = 'e2e/assets/red-blue.png'

async function tapCanvas(page: Page, xFraction: number) {
  const box = await page.getByLabel(/Reference image/).boundingBox()
  if (!box) throw new Error('Reference image is not visible')
  await page.mouse.click(box.x + box.width * xFraction, box.y + box.height / 2)
}

test('samples the same source colour before and after zoom, then restores saved work', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Photos never leave this device')).toBeVisible()
  await page.getByLabel('Choose reference photo').setInputFiles(stripedImage)
  await expect(page.getByText('Mix recipes')).toBeVisible({ timeout: 15000 })
  await tapCanvas(page, .25)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#ff0000/)
  await page.getByLabel('Zoom').fill('2')
  await tapCanvas(page, .5)
  await expect(page.getByTestId('selected-colour')).toHaveText(/^#ff0000/)
  await page.getByRole('button', { name: 'Save sample' }).click()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(page.getByText(/Mix history/)).toBeVisible()
  await page.reload()
  await expect(page.getByLabel(/Reference image/)).toBeVisible()
  await expect(page.getByText(/Saved samples/)).toBeVisible()
  await expect(page.getByText(/Mix recipes/)).toBeVisible()
})
