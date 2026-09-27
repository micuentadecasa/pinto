import { useEffect, useRef, useState } from 'react'
import type { Colour } from './lib/color'
import { direction, imageToScreen, samplePixel, sampleRegion, screenToImage, type Point, type Tone, type Viewport } from './lib/image-analysis'
import { CATALOGUE, suggestAddition, type Recipe } from './lib/mixing'
import { storage, type MixHistoryEntry, type SavedSample } from './lib/storage'

type Analysis = { colour: Colour; tones: Tone[]; recipes: Record<string, { simple: Recipe; complex: Recipe }> }
type Loaded = { id: string; url: string; blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }
type Drag = { pointerId: number; sourceStart: Point; pan: Point; moved: boolean; canSample: boolean }
type Pinch = { distance: number; zoom: number; anchor: Point }

const magnifierSize = 48
const minZoom = 1
const maxZoom = 8

function clampZoom(zoom: number) {
  return Math.max(minZoom, Math.min(maxZoom, zoom))
}

function constrainPan(pan: Point, zoom: number, image: Pick<Loaded, 'width' | 'height'>): Point {
  return {
    x: Math.max(image.width / zoom - image.width, Math.min(0, pan.x)),
    y: Math.max(image.height / zoom - image.height, Math.min(0, pan.y)),
  }
}

async function sourceId(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return `image-${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

async function normalise(file: Blob, id = ''): Promise<Loaded> {
  let source: CanvasImageSource
  let width: number
  let height: number
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    source = bitmap
    width = bitmap.width
    height = bitmap.height
  } catch {
    const url = URL.createObjectURL(file)
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = reject
      element.src = url
    })
    URL.revokeObjectURL(url)
    source = image
    width = image.naturalWidth
    height = image.naturalHeight
  }
  const ratio = Math.min(1, 2560 / Math.max(width, height))
  width = Math.round(width * ratio)
  height = Math.round(height * ratio)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(source, 0, 0, width, height)
  if ('close' in source) (source as ImageBitmap).close()
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
  return { id, url: URL.createObjectURL(blob), blob, width, height, canvas }
}

function Swatch({ tone, selected, onClick }: { tone: Tone; selected: boolean; onClick: () => void }) {
  return <button className={`swatch ${selected ? 'selected' : ''}`} onClick={onClick}><i style={{ background: tone.colour.hex }} /><span>{tone.name}</span><small>{tone.interpolated ? 'estimated ' : ''}{tone.colour.hex}</small></button>
}

export function mixCircleDiameter(percent: number) {
  return Math.round(Math.max(28, Math.min(72, 28 * Math.sqrt(percent / 10))))
}

function orderedMixParts(recipe: Recipe) {
  return [...recipe.parts].sort((first, second) => second.percent - first.percent)
}

function SelectedMixColour({ colour, label = 'Selected colour' }: { colour: Colour; label?: string }) {
  return <div className="selected-mix-colour" data-testid="selected-mix-colour">
    <i aria-hidden="true" style={{ background: colour.hex }} />
    <div><b>{label}</b><small>{colour.hex}</small></div>
  </div>
}

function PaintCircles({ recipe }: { recipe: Recipe }) {
  return <ul className="mix-paints" aria-label={`${recipe.complexity} mix colours`}>
    {orderedMixParts(recipe).map(part => {
      const diameter = mixCircleDiameter(part.percent)
      const labelWidth = Math.max(72, diameter)
      return <li key={part.paint.code} data-percent={part.percent} style={{ width: labelWidth }}>
        <i aria-hidden="true" style={{ width: diameter, height: diameter, background: part.paint.colour.hex }} />
        <span>{part.paint.name}</span>
        <small>{part.percent}% · {part.parts} part{part.parts === 1 ? '' : 's'}</small>
      </li>
    })}
  </ul>
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  return <article className="recipe"><div className="recipe-summary"><div><b>{recipe.complexity} mix</b><small>ΔE {recipe.deltaE.toFixed(1)}</small></div><SelectedMixColour colour={recipe.colour} label="Mix colour" /></div><PaintCircles recipe={recipe} /></article>
}

export default function App() {
  const [image, setImage] = useState<Loaded>()
  const [analysis, setAnalysis] = useState<Analysis>()
  const [analysisImageId, setAnalysisImageId] = useState<string>()
  const [selectedTone, setSelectedTone] = useState('Base')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const [display, setDisplay] = useState({ width: 1, height: 1 })
  const [samples, setSamples] = useState<SavedSample[]>([])
  const [sampleName, setSampleName] = useState('')
  const [history, setHistory] = useState<MixHistoryEntry[]>([])
  const [settingsReady, setSettingsReady] = useState(false)
  const [notice, setNotice] = useState('Choose a reference photo to start.')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | undefined>(undefined)
  const pointers = useRef(new Map<number, Point>())
  const pinch = useRef<Pinch | undefined>(undefined)
  const didPinch = useRef(false)
  const worker = useRef<Worker | undefined>(undefined)
  const generation = useRef(0)

  const analyse = (selectedPoint: Point, source = image) => {
    if (!source) return
    const id = ++generation.current
    setAnalysis(undefined)
    setAnalysisImageId(undefined)
    const data = source.canvas.getContext('2d')!.getImageData(0, 0, source.width, source.height).data
    setNotice('Analysing on this device…')
    worker.current?.postMessage({ id, imageId: source.id, data, width: source.width, height: source.height, point: selectedPoint })
  }

  useEffect(() => {
    worker.current = new Worker(new URL('./workers/analyser.worker.ts', import.meta.url), { type: 'module' })
    worker.current.onmessage = event => {
      if (event.data.id !== generation.current) return
      setAnalysis(event.data)
      setAnalysisImageId(event.data.imageId)
      setSelectedTone('Base')
      setNotice('Colour family and recipes ready.')
    }
    void storage.ensurePalette(CATALOGUE).catch(() => {})
    void storage.getSamples().then(setSamples).catch(() => {})
    void storage.getMixHistory().then(setHistory).catch(() => {})
    const restoreGeneration = ++generation.current
    void (async () => {
      const [settings, saved] = await Promise.all([storage.getSettings(), storage.getLastImage()])
      if (settings?.zoom && settings.zoom >= 1 && settings.zoom <= 8) setZoom(settings.zoom)
      setSettingsReady(true)
      if (!saved) return
      const loaded = await normalise(saved.blob, saved.id)
      if (restoreGeneration !== generation.current) {
        URL.revokeObjectURL(loaded.url)
        return
      }
      setImage(loaded)
      const selectedPoint = { x: loaded.width / 2, y: loaded.height / 2 }
      setPoint(selectedPoint)
      setNotice('Restored your last on-device image.')
      analyse(selectedPoint, loaded)
    })().catch(() => setSettingsReady(true))
    return () => worker.current?.terminate()
  }, [])

  useEffect(() => {
    if (settingsReady) void storage.saveSettings({ zoom }).catch(() => {})
  }, [settingsReady, zoom])

  useEffect(() => {
    if (!image || !canvasRef.current) return
    const canvas = canvasRef.current
    const bounds = canvas.getBoundingClientRect()
    setDisplay(current => current.width === bounds.width && current.height === bounds.height ? current : { width: bounds.width, height: bounds.height })
    const context = canvas.getContext('2d')!
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.save()
    context.scale(zoom, zoom)
    context.translate(pan.x, pan.y)
    context.drawImage(image.canvas, 0, 0)
    context.restore()
  }, [image, pan, zoom])

  const chooseFile = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type) && !file.name.match(/\.hei[cf]$/i)) {
      setNotice('Please select JPEG, PNG, WebP, or a decodable HEIC image.')
      return
    }
    const fileGeneration = ++generation.current
    setAnalysis(undefined)
    setAnalysisImageId(undefined)
    try {
      const imageId = await sourceId(file)
      if (fileGeneration !== generation.current) return
      const loaded = await normalise(file, imageId)
      if (fileGeneration !== generation.current) {
        URL.revokeObjectURL(loaded.url)
        return
      }
      await storage.saveLastImage({ id: loaded.id, blob: loaded.blob, width: loaded.width, height: loaded.height, updatedAt: Date.now() })
      if (fileGeneration !== generation.current) {
        URL.revokeObjectURL(loaded.url)
        return
      }
      setImage(previous => {
        if (previous) URL.revokeObjectURL(previous.url)
        return loaded
      })
      setZoom(minZoom)
      setPan({ x: 0, y: 0 })
      const selectedPoint = { x: loaded.width / 2, y: loaded.height / 2 }
      setPoint(selectedPoint)
      setNotice('Image kept on this device. Tap the photo to sample one exact pixel.')
      analyse(selectedPoint, loaded)
    } catch {
      if (fileGeneration === generation.current) setNotice('This image could not be decoded by this browser. Try JPEG, PNG, or WebP.')
    }
  }

  const viewport = (rect: DOMRect, viewportPan = pan): Viewport => ({ left: rect.left, top: rect.top, displayWidth: rect.width, displayHeight: rect.height, zoom, pan: viewportPan })
  const clientPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => ({ x: event.clientX, y: event.clientY })

  const startDrag = (pointerId: number, start: Point, rect: DOMRect, canSample: boolean) => {
    if (!image) return
    drag.current = {
      pointerId,
      sourceStart: screenToImage(start, viewport(rect, { x: 0, y: 0 }), image, false),
      pan,
      moved: false,
      canSample,
    }
  }

  const startPinch = (rect: DOMRect) => {
    if (!image || pointers.current.size < 2) return
    const [first, second] = [...pointers.current.values()]
    const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    pinch.current = {
      distance: Math.hypot(first.x - second.x, first.y - second.y),
      zoom,
      anchor: screenToImage(center, viewport(rect), image, false),
    }
  }

  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const currentPoint = clientPoint(event)
    if (event.type === 'pointerdown') {
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic pointer events cannot be captured, but still exercise the gesture logic.
      }
      pointers.current.set(event.pointerId, currentPoint)
      if (pointers.current.size === 1) {
        didPinch.current = false
        pinch.current = undefined
        startDrag(event.pointerId, currentPoint, rect, true)
      } else if (pointers.current.size === 2) {
        drag.current = undefined
        didPinch.current = true
        startPinch(rect)
      }
      return
    }
    if (!pointers.current.has(event.pointerId)) return
    if (event.type === 'pointermove') {
      pointers.current.set(event.pointerId, currentPoint)
      if (pointers.current.size >= 2 && pinch.current) {
        const [first, second] = [...pointers.current.values()]
        const distance = Math.hypot(first.x - second.x, first.y - second.y)
        if (distance === 0 || pinch.current.distance === 0) return
        const nextZoom = clampZoom(pinch.current.zoom * distance / pinch.current.distance)
        const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
        const localCenter = {
          x: (center.x - rect.left) * image.width / rect.width,
          y: (center.y - rect.top) * image.height / rect.height,
        }
        setZoom(nextZoom)
        setPan(constrainPan({
          x: localCenter.x / nextZoom - pinch.current.anchor.x,
          y: localCenter.y / nextZoom - pinch.current.anchor.y,
        }, nextZoom, image))
        return
      }
      const activeDrag = drag.current
      if (!activeDrag || activeDrag.pointerId !== event.pointerId) return
      const source = screenToImage(currentPoint, viewport(rect, { x: 0, y: 0 }), image, false)
      const delta = { x: source.x - activeDrag.sourceStart.x, y: source.y - activeDrag.sourceStart.y }
      if (Math.hypot(delta.x, delta.y) > 5) activeDrag.moved = true
      if (activeDrag.moved) setPan(constrainPan({ x: activeDrag.pan.x + delta.x, y: activeDrag.pan.y + delta.y }, zoom, image))
      return
    }

    const activeDrag = drag.current
    pointers.current.delete(event.pointerId)
    if (event.type === 'pointerup' && activeDrag?.pointerId === event.pointerId && !activeDrag.moved && activeDrag.canSample && !didPinch.current) {
      const selectedPoint = screenToImage(currentPoint, viewport(rect), image)
      setPoint(selectedPoint)
      analyse(selectedPoint)
    }
    drag.current = undefined
    if (pointers.current.size === 1) {
      const [remainingId, remainingPoint] = [...pointers.current.entries()][0]
      pinch.current = undefined
      startDrag(remainingId, remainingPoint, rect, false)
    } else if (pointers.current.size === 0) {
      pinch.current = undefined
      didPinch.current = false
    } else {
      startPinch(rect)
    }
  }

  const active = analysis?.tones.find(tone => tone.name === selectedTone) ?? analysis?.tones[2]
  const save = async () => {
    if (!analysis || !image || !active) return
    if (analysisImageId !== image.id) {
      setNotice('Reimport this sample’s source image to save or inspect its location.')
      return
    }
    const sample: SavedSample = {
      id: crypto.randomUUID(), imageId: image.id, name: sampleName.trim() || `Sample ${samples.length + 1}`, point: { x: point.x / image.width, y: point.y / image.height }, colour: analysis.colour, tones: analysis.tones, recipes: analysis.recipes, createdAt: Date.now(),
    }
    const entry: MixHistoryEntry = { id: crypto.randomUUID(), imageId: image.id, sampleId: sample.id, tone: active.name, recipe: analysis.recipes[active.name], createdAt: sample.createdAt }
    await Promise.all([storage.saveSample(sample), storage.saveMixHistory(entry)])
    setSamples(current => [...current, sample])
    setSampleName('')
    setHistory(current => [...current, entry])
    setNotice('Sample and mix saved on this device.')
  }

  const compare = async (file?: File) => {
    if (!file || !active) return
    const comparisonGeneration = ++generation.current
    const target = active
    try {
      const check = await normalise(file)
      const pixels = check.canvas.getContext('2d')!.getImageData(0, 0, check.width, check.height)
      const { deltaE2000 } = await import('./lib/color')
      const mixed = sampleRegion(pixels.data, check.width, check.height, { x: check.width / 2, y: check.height / 2 }, 81)
      const comparison = direction(target.colour.lab, mixed.lab)
      const suggestion = suggestAddition(target.colour.lab, mixed)
      const advice = suggestion ? ` Try a small addition of ${suggestion.paint.code} ${suggestion.paint.name}.` : ' No available paint addition improves this estimate.'
      if (comparisonGeneration === generation.current) setNotice(`Mix check ΔE ${deltaE2000(target.colour.lab, mixed.lab).toFixed(1)}: ${comparison.words.join(', ')}.${advice}`)
      URL.revokeObjectURL(check.url)
    } catch {
      if (comparisonGeneration === generation.current) setNotice('Could not analyse that comparison photo.')
    }
  }

  const selectTone = (tone: Tone['name']) => {
    ++generation.current
    setSelectedTone(tone)
  }
  const selectSample = (sample: SavedSample) => {
    ++generation.current
    setAnalysis({ colour: sample.colour, tones: sample.tones, recipes: sample.recipes })
    setAnalysisImageId(sample.imageId)
    setSelectedTone('Base')
    if (image?.id === sample.imageId) {
      const samplePoint = { x: sample.point.x * image.width, y: sample.point.y * image.height }
      setPoint(samplePoint)
      setNotice('Saved sample restored on its source image.')
    } else {
      setNotice('Saved result loaded. Reimport its source image to inspect its location.')
    }
  }
  const showingSampleLocation = !!image && (!analysis || analysisImageId === image.id)
  const selectedPixel = image ? samplePixel(image.canvas.getContext('2d')!.getImageData(0, 0, image.width, image.height).data, image.width, image.height, point) : undefined
  const magnifiedPoint = image ? imageToScreen(point, { left: 0, top: 0, displayWidth: display.width, displayHeight: display.height, zoom, pan }, image) : { x: 0, y: 0 }
  const primaryRecipe = analysis && active ? analysis.recipes[selectedTone].complex : undefined
  const isPrincipalTone = selectedTone === 'Base'

  return <main>
    <header className="app-header"><h1>Pinto</h1><div className="header-actions"><label className="button">Camera<input aria-label="Take reference photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={event => chooseFile(event.target.files?.[0])} /></label><label className="button secondary">Choose photo<input aria-label="Choose reference photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => chooseFile(event.target.files?.[0])} /></label></div></header>
    {active && primaryRecipe && <section className="used-colours" data-testid="used-colours" aria-labelledby="used-colours-heading"><div className="used-colours-summary"><div><h2 id="used-colours-heading">Colours in the selected mix</h2><p>{active?.name} · closest match</p></div><SelectedMixColour colour={active.colour} /></div><p className="ingredient-label">Paint ingredients</p><PaintCircles recipe={primaryRecipe} /></section>}
    {image && <><section className="viewer"><canvas aria-label={showingSampleLocation ? 'Reference image. Tap to select colour; drag to pan; pinch with two fingers to zoom.' : 'Reference image. Saved sample location unavailable; reimport its source image.'} ref={canvasRef} width={image.width} height={image.height} onPointerDown={pointer} onPointerMove={pointer} onPointerUp={pointer} onPointerCancel={pointer} /><div aria-label="Selected pixel magnifier" className="magnifier" title={selectedPixel?.hex} style={{ left: magnifiedPoint.x - magnifierSize / 2, top: magnifiedPoint.y - magnifierSize / 2, width: magnifierSize, height: magnifierSize, background: selectedPixel?.hex }} /></section><div className="controls"><label>Zoom <input aria-label="Zoom" type="range" min="1" max="8" step=".25" value={zoom} onChange={event => {
      const nextZoom = clampZoom(+event.target.value)
      setZoom(nextZoom)
      setPan(current => constrainPan(current, nextZoom, image))
    }} />{zoom.toFixed(2)}×</label><button onClick={() => analyse(point)}>Resample exact pixel</button></div></>}
    <p className="notice" role="status">{notice}</p>
    {analysis && active && <>{isPrincipalTone && <section className="colour"><i style={{ background: active.colour.hex }} /><div><h2>{active.name}</h2><p data-testid="selected-colour">{active.colour.hex} · sRGB {active.colour.rgb.r}, {active.colour.rgb.g}, {active.colour.rgb.b}</p><p>XYZ {Object.values(active.colour.xyz).map(value => value.toFixed(1)).join(', ')} · Lab {Object.values(active.colour.lab).map(value => value.toFixed(1)).join(', ')}</p></div><label>Sample name <input aria-label="Sample name" value={sampleName} onChange={event => setSampleName(event.target.value)} /></label><button onClick={save}>Save sample</button></section>}<section><h2>Colour family</h2><div className="swatches">{analysis.tones.map(tone => <Swatch key={tone.name} tone={tone} selected={selectedTone === tone.name} onClick={() => selectTone(tone.name)} />)}</div></section><section className="mix-options" data-testid="alternative-mixes"><h2>Other mixes</h2><p>Compare the quick and closest-match recipes; each circle shows the paint and its amount.</p><RecipeCard recipe={analysis.recipes[selectedTone].simple} /><RecipeCard recipe={analysis.recipes[selectedTone].complex} /></section><section><h2>Check my mix</h2><p>Photograph a small, evenly lit dab and compare it with {active.name}.</p><label className="button secondary">Capture / import mix<input aria-label="Check my mix photo" type="file" accept="image/*" capture="environment" onChange={event => compare(event.target.files?.[0])} /></label></section></>}
    {samples.length > 0 && <section><h2>Saved samples ({samples.length})</h2>{samples.map(sample => <button key={sample.id} className="saved" onClick={() => selectSample(sample)}><i style={{ background: sample.colour.hex }} />{sample.name}</button>)}</section>}
    {history.length > 0 && <section><h2>Mix history ({history.length})</h2>{history.map(entry => <p key={entry.id}>{entry.tone}: {orderedMixParts(entry.recipe.complex).map(part => part.paint.code).join(', ')}</p>)}</section>}
    <footer>Fixed catalogue: 105, 268, 270, 393, 366, 504, 535, 619, 409, 701.</footer>
  </main>
}
