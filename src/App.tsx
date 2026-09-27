import { useEffect, useRef, useState } from 'react'
import type { Colour } from './lib/color'
import { direction, imageToScreen, screenToImage, type Point, type Tone, type Viewport } from './lib/image-analysis'
import { CATALOGUE, optimizeRecipes, suggestAddition, type Recipe } from './lib/mixing'
import { storage, type MixHistoryEntry, type SavedSample } from './lib/storage'

type Analysis = { colour: Colour; tones: Tone[]; recipes: Record<string, { simple: Recipe; complex: Recipe }> }
type Loaded = { url: string; blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }
type Drag = { sourceStart: Point; pan: Point; moved: boolean }

const sizes = [9, 21, 41, 81]
const magnifierSize = 96

async function normalise(file: Blob): Promise<Loaded> {
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
  return { url: URL.createObjectURL(blob), blob, width, height, canvas }
}

function Swatch({ tone, selected, onClick }: { tone: Tone; selected: boolean; onClick: () => void }) {
  return <button className={`swatch ${selected ? 'selected' : ''}`} onClick={onClick}><i style={{ background: tone.colour.hex }} /><span>{tone.name}</span><small>{tone.interpolated ? 'estimated ' : ''}{tone.colour.hex}</small></button>
}

function RecipeCard({ recipe }: { recipe: Recipe }) {
  return <article className="recipe"><b>{recipe.complexity} · ΔE {recipe.deltaE.toFixed(1)}</b><p>{recipe.parts.map(part => <span key={part.paint.code}>{part.paint.code} {part.paint.name}: <strong>{part.percent}%</strong> ({part.parts} parts)</span>)}</p></article>
}

export default function App() {
  const [image, setImage] = useState<Loaded>()
  const [analysis, setAnalysis] = useState<Analysis>()
  const [selectedTone, setSelectedTone] = useState('Base')
  const [region, setRegion] = useState(21)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const [magnifier, setMagnifier] = useState({ x: 8, y: 8 })
  const [samples, setSamples] = useState<SavedSample[]>([])
  const [sampleName, setSampleName] = useState('')
  const [history, setHistory] = useState<MixHistoryEntry[]>([])
  const [settingsReady, setSettingsReady] = useState(false)
  const [notice, setNotice] = useState('Choose a reference photo to start.')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag>()
  const worker = useRef<Worker>()

  const analyse = (selectedPoint: Point, source = image) => {
    if (!source) return
    const data = source.canvas.getContext('2d')!.getImageData(0, 0, source.width, source.height).data
    setNotice('Analysing on this device…')
    worker.current?.postMessage({ id: Date.now(), data, width: source.width, height: source.height, point: selectedPoint, size: region })
  }

  useEffect(() => {
    worker.current = new Worker(new URL('./workers/analyser.worker.ts', import.meta.url), { type: 'module' })
    worker.current.onmessage = event => {
      setAnalysis(event.data)
      setSelectedTone('Base')
      setNotice('Colour family and recipes ready.')
    }
    void storage.ensurePalette(CATALOGUE).catch(() => {})
    void storage.getSamples().then(setSamples).catch(() => {})
    void storage.getMixHistory().then(setHistory).catch(() => {})
    void storage.getSettings().then(settings => {
      if (settings?.region && sizes.includes(settings.region)) setRegion(settings.region)
      if (settings?.zoom && settings.zoom >= 1 && settings.zoom <= 8) setZoom(settings.zoom)
      setSettingsReady(true)
    }).catch(() => setSettingsReady(true))
    void storage.getLastImage().then(async saved => {
      if (!saved) return
      const loaded = await normalise(saved.blob)
      setImage(loaded)
      const selectedPoint = { x: loaded.width / 2, y: loaded.height / 2 }
      setPoint(selectedPoint)
      setNotice('Restored your last on-device image.')
      setTimeout(() => analyse(selectedPoint, loaded), 0)
    }).catch(() => {})
    return () => worker.current?.terminate()
  }, [])

  useEffect(() => {
    if (settingsReady) void storage.saveSettings({ region, zoom }).catch(() => {})
  }, [region, settingsReady, zoom])

  useEffect(() => {
    if (!image || !canvasRef.current) return
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')!
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.save()
    context.scale(zoom, zoom)
    context.translate(pan.x, pan.y)
    context.drawImage(image.canvas, 0, 0)
    context.restore()
    const marker = imageToScreen(point, { left: 0, top: 0, displayWidth: canvas.width, displayHeight: canvas.height, zoom, pan }, image)
    context.strokeStyle = 'white'
    context.lineWidth = 3 / zoom
    context.beginPath()
    context.arc(marker.x, marker.y, 12 / zoom, 0, Math.PI * 2)
    context.stroke()
    context.strokeStyle = '#173a31'
    context.lineWidth = 1 / zoom
    context.beginPath()
    context.moveTo(marker.x - 18 / zoom, marker.y)
    context.lineTo(marker.x + 18 / zoom, marker.y)
    context.moveTo(marker.x, marker.y - 18 / zoom)
    context.lineTo(marker.x, marker.y + 18 / zoom)
    context.stroke()
  }, [image, pan, point, zoom])

  const chooseFile = async (file?: File) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.type) && !file.name.match(/\.hei[cf]$/i)) {
      setNotice('Please select JPEG, PNG, WebP, or a decodable HEIC image.')
      return
    }
    try {
      const loaded = await normalise(file)
      setImage(previous => {
        if (previous) URL.revokeObjectURL(previous.url)
        return loaded
      })
      setZoom(1)
      setPan({ x: 0, y: 0 })
      const selectedPoint = { x: loaded.width / 2, y: loaded.height / 2 }
      setPoint(selectedPoint)
      await storage.saveLastImage({ id: 'last', blob: loaded.blob, width: loaded.width, height: loaded.height, updatedAt: Date.now() })
      setNotice('Image kept on this device. Tap the photo to sample.')
      setTimeout(() => analyse(selectedPoint, loaded), 0)
    } catch {
      setNotice('This image could not be decoded by this browser. Try JPEG, PNG, or WebP.')
    }
  }

  const viewport = (rect: DOMRect, viewportPan = pan): Viewport => ({ left: rect.left, top: rect.top, displayWidth: rect.width, displayHeight: rect.height, zoom, pan: viewportPan })
  const placeMagnifier = (rect: DOMRect, clientX: number, clientY: number) => {
    const pointerX = clientX - rect.left
    const pointerY = clientY - rect.top
    const gap = 28
    const left = pointerX + magnifierSize + gap <= rect.width ? pointerX + gap : pointerX - magnifierSize - gap
    const top = pointerY - magnifierSize - gap >= 0 ? pointerY - magnifierSize - gap : pointerY + gap
    setMagnifier({ x: Math.max(8, Math.min(rect.width - magnifierSize - 8, left)), y: Math.max(8, Math.min(rect.height - magnifierSize - 8, top)) })
  }

  const pointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return
    const rect = event.currentTarget.getBoundingClientRect()
    placeMagnifier(rect, event.clientX, event.clientY)
    if (event.type === 'pointerdown') {
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { sourceStart: screenToImage({ x: event.clientX, y: event.clientY }, viewport(rect, { x: 0, y: 0 }), image, false), pan, moved: false }
      return
    }
    if (event.type === 'pointermove' && drag.current) {
      const current = screenToImage({ x: event.clientX, y: event.clientY }, viewport(rect, { x: 0, y: 0 }), image, false)
      const delta = { x: current.x - drag.current.sourceStart.x, y: current.y - drag.current.sourceStart.y }
      if (Math.hypot(delta.x, delta.y) > 5) drag.current.moved = true
      if (drag.current.moved) setPan({ x: drag.current.pan.x + delta.x, y: drag.current.pan.y + delta.y })
      return
    }
    if (event.type === 'pointercancel') {
      drag.current = undefined
      return
    }
    if (event.type === 'pointerup' && drag.current) {
      const moved = drag.current.moved
      drag.current = undefined
      if (!moved) {
        const selectedPoint = screenToImage({ x: event.clientX, y: event.clientY }, viewport(rect), image)
        setPoint(selectedPoint)
        analyse(selectedPoint)
      }
    }
  }

  const active = analysis?.tones.find(tone => tone.name === selectedTone) ?? analysis?.tones[2]
  const save = async () => {
    if (!analysis || !image || !active) return
    const sample: SavedSample = {
      id: crypto.randomUUID(), imageId: 'last', name: sampleName.trim() || `Sample ${samples.length + 1}`, point: { x: point.x / image.width, y: point.y / image.height }, colour: analysis.colour, tones: analysis.tones, recipes: analysis.recipes, createdAt: Date.now(),
    }
    const entry: MixHistoryEntry = { id: crypto.randomUUID(), imageId: 'last', sampleId: sample.id, tone: active.name, recipe: analysis.recipes[active.name], createdAt: sample.createdAt }
    await Promise.all([storage.saveSample(sample), storage.saveMixHistory(entry)])
    setSamples(current => [...current, sample])
    setSampleName('')
    setHistory(current => [...current, entry])
    setNotice('Sample and mix saved on this device.')
  }

  const compare = async (file?: File) => {
    if (!file || !active) return
    try {
      const check = await normalise(file)
      const pixels = check.canvas.getContext('2d')!.getImageData(0, 0, check.width, check.height)
      const { deltaE2000, rgbToColour } = await import('./lib/color')
      const mixed = rgbToColour({ r: pixels.data[0], g: pixels.data[1], b: pixels.data[2] })
      const comparison = direction(active.colour.lab, mixed.lab)
      const recipe = analysis?.recipes[selectedTone]?.complex ?? optimizeRecipes(active.colour.lab).complex
      const suggestion = suggestAddition(active.colour.lab, recipe)
      setNotice(`Mix check ΔE ${deltaE2000(active.colour.lab, mixed.lab).toFixed(1)}: ${comparison.words.join(', ')}. Try a small addition of ${suggestion.paint.code} ${suggestion.paint.name}.`)
      URL.revokeObjectURL(check.url)
    } catch {
      setNotice('Could not analyse that comparison photo.')
    }
  }

  return <main>
    <header><div><h1>Pinto</h1><p>Van Gogh basic oils mixer</p></div><strong className="private">🔒 Photos never leave this device</strong></header>
    <section className="intro"><h2>Match a colour from a photo</h2><p>Recipe estimates use photographed colour in CIELAB, not a physical pigment calibration.</p><div className="actions"><label className="button">Camera<input aria-label="Take reference photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={event => chooseFile(event.target.files?.[0])} /></label><label className="button secondary">Choose photo<input aria-label="Choose reference photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event => chooseFile(event.target.files?.[0])} /></label></div></section>
    {image && <><section className="viewer"><canvas aria-label="Reference image. Tap to select colour; drag to pan." ref={canvasRef} width={image.width} height={image.height} onPointerDown={pointer} onPointerMove={pointer} onPointerUp={pointer} onPointerCancel={pointer} /><div aria-label="5× magnifier" className="magnifier" style={{ left: magnifier.x, top: magnifier.y, backgroundImage: `url(${image.url})`, backgroundSize: `${image.width * 5}px ${image.height * 5}px`, backgroundPosition: `${magnifierSize / 2 - point.x * 5}px ${magnifierSize / 2 - point.y * 5}px` }}>+</div></section><div className="controls"><label>Zoom <input aria-label="Zoom" type="range" min="1" max="8" step=".25" value={zoom} onChange={event => setZoom(+event.target.value)} />{zoom.toFixed(2)}×</label><label>Sample area <select value={region} onChange={event => setRegion(+event.target.value)}>{sizes.map(size => <option key={size}>{size}×{size}</option>)}</select></label><button onClick={() => analyse(point)}>Resample</button></div></>}
    <p className="notice" role="status">{notice}</p>
    {analysis && active && <><section className="colour"><i style={{ background: active.colour.hex }} /><div><h2>{active.name}</h2><p data-testid="selected-colour">{active.colour.hex} · sRGB {active.colour.rgb.r}, {active.colour.rgb.g}, {active.colour.rgb.b}</p><p>XYZ {Object.values(active.colour.xyz).map(value => value.toFixed(1)).join(', ')} · Lab {Object.values(active.colour.lab).map(value => value.toFixed(1)).join(', ')}</p></div><label>Sample name <input aria-label="Sample name" value={sampleName} onChange={event => setSampleName(event.target.value)} /></label><button onClick={save}>Save sample</button></section><section><h2>Colour family</h2><div className="swatches">{analysis.tones.map(tone => <Swatch key={tone.name} tone={tone} selected={selectedTone === tone.name} onClick={() => setSelectedTone(tone.name)} />)}</div></section><section><h2>Mix recipes</h2><RecipeCard recipe={analysis.recipes[selectedTone].simple} /><RecipeCard recipe={analysis.recipes[selectedTone].complex} /></section><section><h2>Check my mix</h2><p>Photograph a small, evenly lit dab and compare it with {active.name}.</p><label className="button secondary">Capture / import mix<input aria-label="Check my mix photo" type="file" accept="image/*" capture="environment" onChange={event => compare(event.target.files?.[0])} /></label></section></>}
    {samples.length > 0 && <section><h2>Saved samples ({samples.length})</h2>{samples.map(sample => <button key={sample.id} className="saved" onClick={() => { setAnalysis({ colour: sample.colour, tones: sample.tones, recipes: sample.recipes }); setSelectedTone('Base') }}><i style={{ background: sample.colour.hex }} />{sample.name}</button>)}</section>}
    {history.length > 0 && <section><h2>Mix history ({history.length})</h2>{history.map(entry => <p key={entry.id}>{entry.tone}: {entry.recipe.complex.parts.map(part => part.paint.code).join(', ')}</p>)}</section>}
    <footer>Fixed catalogue: 105, 268, 270, 393, 366, 504, 535, 619, 409, 701.</footer>
  </main>
}
