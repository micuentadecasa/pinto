import { describe, expect, it } from 'vitest'
import { labToColour, rgbToColour } from '../src/lib/color'
import { CATALOGUE, optimizeRecipes, suggestAddition, type MixingModel } from '../src/lib/mixing'
import { storage } from '../src/lib/storage'
import { mixCircleDiameter } from '../src/App'

describe('mixing and recovery', () => {
  it('keeps 10% mix circles legible while bounding larger percentages', () => {
    expect(mixCircleDiameter(10)).toBe(28)
    expect(mixCircleDiameter(60)).toBe(69)
    expect(mixCircleDiameter(60)).toBeLessThan(96)
    expect(mixCircleDiameter(100)).toBe(72)
  })

  it('deterministically searches the complete fine grid without leaving the fixed catalogue', () => {
    const target = rgbToColour({ r: 110, g: 80, b: 60 }).lab
    const first = optimizeRecipes(target)
    const second = optimizeRecipes(target)
    expect(first.complex.parts).toEqual(second.complex.parts)
    expect(first.complex.deltaE).toBeLessThanOrEqual(first.simple.deltaE)
    for (const part of [...first.simple.parts, ...first.complex.parts]) expect(CATALOGUE).toContain(part.paint)
    expect(first.complex.parts.length).toBeLessThanOrEqual(4)
  })

  it('finds a lower-error 10/90 candidate outside the coarse anchor', () => {
    const target = { l: 60, a: 0, b: 0 }
    const model: MixingModel = {
      mix(parts) {
        const white = parts.find(part => part.paint.code === '105')
        const black = parts.find(part => part.paint.code === '701')
        if (parts.length === 2 && white && black) return labToColour({ l: 60 + Math.abs(white.amount - .1) * 100, a: 0, b: 0 })
        return labToColour({ l: 100, a: 0, b: 0 })
      },
    }
    const recipes = optimizeRecipes(target, model)
    expect(recipes.simple.parts.map(part => part.paint.code)).toEqual(['105', '701'])
    expect(recipes.complex.parts.map(part => part.paint.code)).toEqual(['105', '701'])
    expect(recipes.complex.parts.map(part => part.parts)).toEqual([1, 9])
    expect(recipes.complex.deltaE).toBe(0)
  })

  it('withholds additions that cannot improve an observed exact mix', () => {
    const exact = rgbToColour({ r: 110, g: 80, b: 60 })
    expect(suggestAddition(exact.lab, exact)).toBeUndefined()
  })

  it('persists image, immutable palette, settings, samples, and mix history', async () => {
    const blob = new Blob(['pixels'], { type: 'image/png' })
    const colour = rgbToColour({ r: 1, g: 2, b: 3 })
    const recipes = optimizeRecipes(colour.lab)
    await storage.saveLastImage({ id: 'image-a', blob, width: 5, height: 7, updatedAt: 1 })
    await storage.saveLastImage({ id: 'image-b', blob, width: 7, height: 5, updatedAt: 2 })
    await storage.ensurePalette(CATALOGUE)
    await storage.ensurePalette([])
    await storage.saveSettings({ region: 41, zoom: 2 })
    await Promise.all([
      storage.saveSample({ id: 'a', imageId: 'image-a', name: 'A', point: { x: .25, y: .5 }, colour, tones: [], recipes: {}, createdAt: 1 }),
      storage.saveSample({ id: 'b', imageId: 'image-b', name: 'B', point: { x: .75, y: .5 }, colour, tones: [], recipes: {}, createdAt: 2 }),
    ])
    await storage.saveMixHistory({ id: 'mix-a', imageId: 'image-a', sampleId: 'a', tone: 'Base', recipe: recipes, createdAt: 1 })
    expect((await storage.getLastImage())?.id).toBe('image-b')
    expect((await storage.getPalette())?.paints.map(paint => paint.code)).toEqual(CATALOGUE.map(paint => paint.code))
    expect(await storage.getSettings()).toEqual({ region: 41, zoom: 2 })
    expect((await storage.getSamples()).map(sample => [sample.id, sample.imageId])).toEqual(expect.arrayContaining([['a', 'image-a'], ['b', 'image-b']]))
    expect((await storage.getMixHistory()).map(entry => entry.id)).toContain('mix-a')
  })
})
