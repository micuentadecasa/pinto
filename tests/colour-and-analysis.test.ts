import { describe, expect, it } from 'vitest'
import { deltaE2000, labToColour, rgbToColour } from '../src/lib/color'
import { imageToScreen, makeToneFamily, sampleRegion, screenToImage } from '../src/lib/image-analysis'

describe('image analysis', () => {
  it('maps display points to source pixels and back through the shared transform', () => {
    const viewport = { left: 10, top: 10, displayWidth: 500, displayHeight: 500, zoom: 2, pan: { x: 0, y: 0 } }
    const image = { width: 500, height: 500 }
    expect(screenToImage({ x: 210, y: 110 }, viewport, image)).toEqual({ x: 100, y: 50 })
    expect(imageToScreen({ x: 100, y: 50 }, viewport, image)).toEqual({ x: 210, y: 110 })
  })

  it('samples a robust colour while rejecting bright luminance outlier', () => {
    const data = new Uint8ClampedArray(9 * 9 * 4)
    for (let index = 0; index < data.length; index += 4) data.set([100, 50, 25, 255], index)
    data.set([255, 255, 255, 255], 0)
    const colour = sampleRegion(data, 9, 9, { x: 4, y: 4 }, 9)
    expect(colour.rgb.r).toBe(100)
    expect(colour.rgb.g).toBe(50)
  })

  it('samples the central comparison region instead of a corner background', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4)
    for (let index = 0; index < data.length; index += 4) data.set([150, 75, 40, 255], index)
    data.set([0, 0, 255, 255], 0)
    expect(sampleRegion(data, 100, 100, { x: 50, y: 50 }, 81).rgb).toEqual({ r: 150, g: 75, b: 40 })
  })

  it('clusters related context, rejects unrelated hues, and generates sparse tonal variation', () => {
    const base = rgbToColour({ r: 150, g: 75, b: 40 })
    const light = rgbToColour({ r: 205, g: 130, b: 85 })
    const dark = rgbToColour({ r: 75, g: 32, b: 20 })
    const blue = rgbToColour({ r: 0, g: 50, b: 245 })
    const tones = makeToneFamily(base, [light, light, dark, blue])
    expect(tones.map(tone => tone.name)).toEqual(['Highlight', 'Light', 'Base', 'Shadow', 'Deep Shadow'])
    expect(tones[0].colour.lab.l).toBeGreaterThan(tones[4].colour.lab.l)
    expect(tones.some(tone => tone.colour.hex === blue.hex)).toBe(false)
    const sparse = makeToneFamily(base, Array.from({ length: 9 }, () => base))
    expect(sparse.map(tone => tone.colour.lab.l)).toEqual([...sparse.map(tone => tone.colour.lab.l)].sort((a, b) => b - a))
    expect(sparse.filter(tone => tone.name !== 'Base').every(tone => tone.interpolated)).toBe(true)
    expect(new Set(sparse.map(tone => tone.colour.hex)).size).toBe(5)
  })

  it('interpolates strictly interior tones when contextual endpoints share lightness', () => {
    const base = labToColour({ l: 50, a: 0, b: 0 })
    const tones = makeToneFamily(base, [
      labToColour({ l: 60, a: -18, b: 0 }),
      labToColour({ l: 60, a: 18, b: 0 }),
      labToColour({ l: 40, a: -18, b: 0 }),
      labToColour({ l: 40, a: 18, b: 0 }),
    ])
    const lightness = tones.map(tone => tone.colour.lab.l)
    expect(lightness).toEqual([...lightness].sort((a, b) => b - a))
    for (let index = 0; index < lightness.length - 1; index++) expect(lightness[index]).toBeGreaterThan(lightness[index + 1])
    expect(tones[1].interpolated).toBe(true)
    expect(tones[3].interpolated).toBe(true)
  })

  it('has zero deltaE for the same colour', () => {
    const colour = rgbToColour({ r: 100, g: 120, b: 60 })
    expect(deltaE2000(colour.lab, colour.lab)).toBe(0)
  })
})
