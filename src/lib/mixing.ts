import { deltaE2000, labToColour, mixLabs, rgbToColour, type Colour, type Lab } from './color'

export type Paint = { code: string; name: string; colour: Colour }
export const CATALOGUE: readonly Paint[] = [
  ['105', 'Titanium White', '#f4f2e8'], ['268', 'Azo Yellow Light', '#f6c620'], ['270', 'Azo Yellow Deep', '#e89b14'], ['393', 'Azo Red Medium', '#c94132'], ['366', 'Quinacridone Rose', '#bd315c'], ['504', 'Ultramarine', '#263b91'], ['535', 'Cerulean Blue Phthalo', '#087faa'], ['619', 'Permanent Green Deep', '#17633d'], ['409', 'Burnt Umber', '#69442e'], ['701', 'Ivory Black', '#272827'],
].map(([code, name, hex]) => {
  const numeric = parseInt(hex.slice(1), 16)
  return { code, name, colour: rgbToColour({ r: numeric >> 16, g: (numeric >> 8) & 255, b: numeric & 255 }) }
})

export interface MixingModel { mix(parts: { paint: Paint; amount: number }[]): Colour }
export const labMixingModel: MixingModel = { mix(parts) { return labToColour(mixLabs(parts.map(part => ({ lab: part.paint.colour.lab, amount: part.amount })))) } }
export type Recipe = { parts: { paint: Paint; percent: number; parts: number }[]; colour: Colour; deltaE: number; complexity: 'Simple' | 'Complex' }

type Candidate = { paints: Paint[]; amounts: number[] }

function compositions(count: number, units: number, minimum = 1, prefix: number[] = []): number[][] {
  if (count === 1) return units >= minimum ? [[...prefix, units]] : []
  const output: number[][] = []
  for (let amount = minimum; amount <= units - minimum * (count - 1); amount++) output.push(...compositions(count - 1, units - amount, minimum, [...prefix, amount]))
  return output
}

function groups<T>(items: T[], count: number, start = 0, prefix: T[] = []): T[][] {
  if (!count) return [prefix]
  const output: T[][] = []
  for (let index = start; index <= items.length - count; index++) output.push(...groups(items, count - 1, index + 1, [...prefix, items[index]]))
  return output
}

function recipeFor(target: Lab, candidate: Candidate, units: number, complexity: Recipe['complexity'], model: MixingModel): Recipe {
  const colour = model.mix(candidate.paints.map((paint, index) => ({ paint, amount: candidate.amounts[index] / units })))
  return {
    colour,
    deltaE: deltaE2000(target, colour.lab),
    complexity,
    parts: candidate.paints.map((paint, index) => ({ paint, percent: Math.round(candidate.amounts[index] / units * 100), parts: candidate.amounts[index] })),
  }
}

function coarseSearch(target: Lab, model: MixingModel): Recipe {
  let best: Recipe | undefined
  for (let count = 1; count <= 4; count++) {
    for (const paints of groups([...CATALOGUE], count)) {
      for (const amounts of compositions(count, 4)) {
        const candidate = recipeFor(target, { paints, amounts }, 4, 'Simple', model)
        if (!best || candidate.deltaE < best.deltaE - 1e-9) best = candidate
      }
    }
  }
  return best!
}

function refine(target: Lab, coarse: Recipe, model: MixingModel): Recipe {
  let best: Recipe = { ...coarse, complexity: 'Complex' }
  for (let count = 1; count <= 4; count++) {
    for (const paints of groups([...CATALOGUE], count)) {
      for (const amounts of compositions(count, 10)) {
        const candidate = recipeFor(target, { paints, amounts }, 10, 'Complex', model)
        if (candidate.deltaE < best.deltaE - 1e-9) best = candidate
      }
    }
  }
  return best
}

export function optimizeRecipes(target: Lab, model: MixingModel = labMixingModel): { simple: Recipe; complex: Recipe } {
  const simple = coarseSearch(target, model)
  return { simple, complex: refine(target, simple, model) }
}

export function suggestAddition(target: Lab, current: Colour, model: MixingModel = labMixingModel) {
  const baseline = deltaE2000(target, current.lab)
  const observed: Paint = { code: 'observed', name: 'Observed mix', colour: current }
  let best: { paint: Paint; deltaE: number } | undefined
  for (const paint of CATALOGUE) {
    const next = model.mix([{ paint: observed, amount: .95 }, { paint, amount: .05 }])
    const deltaE = deltaE2000(target, next.lab)
    if (deltaE < baseline - 1e-9 && (!best || deltaE < best.deltaE)) best = { paint, deltaE }
  }
  return best
}
