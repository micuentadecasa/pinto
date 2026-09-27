import { deltaE2000, labToColour, rgbToColour, type Colour, type Lab, type RGB } from './color'

export type Point = { x: number; y: number }
export type Viewport = { left: number; top: number; displayWidth: number; displayHeight: number; zoom: number; pan: Point }
export type Tone = { name: 'Highlight' | 'Light' | 'Base' | 'Shadow' | 'Deep Shadow'; colour: Colour; interpolated?: boolean }

const clamp = (value: number, maximum: number) => Math.max(0, Math.min(maximum - 1, value))

export function screenToImage(point: Point, viewport: Viewport, image: { width: number; height: number }, clampToBounds = true): Point {
  const source = {
    x: ((point.x - viewport.left) * image.width / viewport.displayWidth) / viewport.zoom - viewport.pan.x,
    y: ((point.y - viewport.top) * image.height / viewport.displayHeight) / viewport.zoom - viewport.pan.y,
  }
  return clampToBounds ? { x: clamp(source.x, image.width), y: clamp(source.y, image.height) } : source
}

export function imageToScreen(point: Point, viewport: Viewport, image: { width: number; height: number }): Point {
  return {
    x: viewport.left + ((point.x + viewport.pan.x) * viewport.zoom / image.width) * viewport.displayWidth,
    y: viewport.top + ((point.y + viewport.pan.y) * viewport.zoom / image.height) * viewport.displayHeight,
  }
}

export function sampleRegion(data: Uint8ClampedArray, width: number, height: number, center: Point, size: number): Colour {
  const pixels: { rgb: RGB; l: number }[] = []
  const radius = Math.floor(size / 2)
  for (let y = Math.max(0, Math.round(center.y) - radius); y <= Math.min(height - 1, Math.round(center.y) + radius); y++) {
    for (let x = Math.max(0, Math.round(center.x) - radius); x <= Math.min(width - 1, Math.round(center.x) + radius); x++) {
      const index = (y * width + x) * 4
      if (data[index + 3] >= 32) {
        const rgb = { r: data[index], g: data[index + 1], b: data[index + 2] }
        pixels.push({ rgb, l: rgbToColour(rgb).lab.l })
      }
    }
  }
  if (!pixels.length) return rgbToColour({ r: 0, g: 0, b: 0 })
  const lightness = pixels.map(pixel => pixel.l).sort((a, b) => a - b)
  const low = lightness[Math.floor(lightness.length * .1)]
  const high = lightness[Math.ceil(lightness.length * .9) - 1]
  const retained = pixels.filter(pixel => pixel.l >= low && pixel.l <= high)
  const mean = (key: keyof RGB) => Math.round(retained.reduce((sum, pixel) => sum + pixel.rgb[key], 0) / retained.length)
  return rgbToColour({ r: mean('r'), g: mean('g'), b: mean('b') })
}

function average(colours: Colour[]): Colour {
  const total = colours.reduce((sum, colour) => ({ l: sum.l + colour.lab.l, a: sum.a + colour.lab.a, b: sum.b + colour.lab.b }), { l: 0, a: 0, b: 0 })
  return labToColour({ l: total.l / colours.length, a: total.a / colours.length, b: total.b / colours.length })
}

export function clusterRelatedColours(base: Colour, context: Colour[]): Colour[] {
  const clusters: Colour[][] = []
  for (const colour of context.filter(candidate => deltaE2000(base.lab, candidate.lab) < 32)) {
    const cluster = clusters.find(candidate => deltaE2000(average(candidate).lab, colour.lab) < 12)
    if (cluster) cluster.push(colour)
    else clusters.push([colour])
  }
  return clusters.map(average)
}

function interpolate(base: Colour, endpoint: Colour, amount: number): Colour {
  return labToColour({
    l: base.lab.l + (endpoint.lab.l - base.lab.l) * amount,
    a: base.lab.a + (endpoint.lab.a - base.lab.a) * amount,
    b: base.lab.b + (endpoint.lab.b - base.lab.b) * amount,
  })
}

function extrapolate(base: Colour, lightnessDelta: number): Colour {
  const factor = lightnessDelta > 0 ? .9 : .98
  return labToColour({ l: Math.max(0, Math.min(100, base.lab.l + lightnessDelta)), a: base.lab.a * factor, b: base.lab.b * factor })
}

function nearestByLightness(colours: Colour[], target: number): Colour {
  return colours.reduce((best, colour) => Math.abs(colour.lab.l - target) < Math.abs(best.lab.l - target) ? colour : best)
}

export function makeToneFamily(base: Colour, context: Colour[]): Tone[] {
  const clusters = clusterRelatedColours(base, context)
  const lights = clusters.filter(colour => colour.lab.l > base.lab.l + 2)
  const shadows = clusters.filter(colour => colour.lab.l < base.lab.l - 2)
  const brightest = lights.length ? lights.reduce((best, colour) => colour.lab.l > best.lab.l ? colour : best) : undefined
  const darkest = shadows.length ? shadows.reduce((best, colour) => colour.lab.l < best.lab.l ? colour : best) : undefined
  const highlight = brightest ? { colour: brightest } : { colour: extrapolate(base, 30), interpolated: true }
  const light = lights.length > 1
    ? { colour: nearestByLightness(lights, base.lab.l + (brightest!.lab.l - base.lab.l) / 2) }
    : brightest ? { colour: interpolate(base, brightest, .5), interpolated: true } : { colour: extrapolate(base, 15), interpolated: true }
  const shadow = shadows.length > 1
    ? { colour: nearestByLightness(shadows, base.lab.l + (darkest!.lab.l - base.lab.l) / 2) }
    : darkest ? { colour: interpolate(base, darkest, .5), interpolated: true } : { colour: extrapolate(base, -15), interpolated: true }
  const deepShadow = darkest ? { colour: darkest } : { colour: extrapolate(base, -30), interpolated: true }
  return [
    { name: 'Highlight', ...highlight },
    { name: 'Light', ...light },
    { name: 'Base', colour: base },
    { name: 'Shadow', ...shadow },
    { name: 'Deep Shadow', ...deepShadow },
  ]
}

export function contextSamples(data: Uint8ClampedArray, width: number, height: number, center: Point): Colour[] {
  const samples: Colour[] = []
  for (let y = -80; y <= 80; y += 20) for (let x = -80; x <= 80; x += 20) samples.push(sampleRegion(data, width, height, { x: center.x + x, y: center.y + y }, 21))
  return samples
}

export function direction(target: Lab, actual: Lab) {
  const dl = actual.l - target.l
  const da = actual.a - target.a
  const db = actual.b - target.b
  return {
    dl,
    da,
    db,
    words: [
      dl > 2 ? 'too light' : dl < -2 ? 'too dark' : 'close in lightness',
      da > 2 ? 'too red/warm' : da < -2 ? 'too green/cool' : 'close in red-green',
      db > 2 ? 'too yellow/warm' : db < -2 ? 'too blue/cool' : 'close in yellow-blue',
    ],
  }
}
