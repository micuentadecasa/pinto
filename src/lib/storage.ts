import type { Colour } from './color'
import type { Tone } from './image-analysis'
import type { Paint, Recipe } from './mixing'

export type StoredImage = { id: 'last'; blob: Blob; width: number; height: number; updatedAt: number }
export type SavedSample = { id: string; imageId: 'last'; name: string; point: { x: number; y: number }; colour: Colour; tones: Tone[]; recipes: Record<string, { simple: Recipe; complex: Recipe }>; createdAt: number }
export type PaletteSnapshot = { id: 'fixed'; paints: Paint[]; savedAt: number }
export type MixHistoryEntry = { id: string; imageId: 'last'; sampleId: string; tone: Tone['name']; recipe: { simple: Recipe; complex: Recipe }; createdAt: number }
export type Settings = { region?: number; zoom?: number }

const DB = 'pinto-v1'
const STORE = 'records'
let dbPromise: Promise<IDBDatabase> | undefined

function db() {
  return dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function get<T>(key: string): Promise<T | undefined> {
  return db().then(database => new Promise<T | undefined>((resolve, reject) => {
    const request = database.transaction(STORE).objectStore(STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))
}

function put(key: string, value: unknown): Promise<void> {
  return db().then(database => new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }))
}

function update<T>(key: string, updater: (current: T | undefined) => T): Promise<void> {
  return db().then(database => new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    const request = store.get(key)
    request.onsuccess = () => store.put(updater(request.result), key)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  }))
}

export const storage = {
  getLastImage: () => get<StoredImage>('image:last'),
  saveLastImage: (image: StoredImage) => put('image:last', image),
  getSamples: async () => await get<SavedSample[]>('samples') ?? [],
  saveSample: (sample: SavedSample) => update<SavedSample[]>('samples', samples => [...(samples ?? []), sample]),
  getPalette: () => get<PaletteSnapshot>('palette:fixed'),
  ensurePalette: (paints: readonly Paint[]) => update<PaletteSnapshot>('palette:fixed', palette => palette ?? { id: 'fixed', paints: paints.map(paint => ({ ...paint, colour: { ...paint.colour, rgb: { ...paint.colour.rgb }, xyz: { ...paint.colour.xyz }, lab: { ...paint.colour.lab } } })), savedAt: Date.now() }),
  getMixHistory: async () => await get<MixHistoryEntry[]>('mix-history') ?? [],
  saveMixHistory: (entry: MixHistoryEntry) => update<MixHistoryEntry[]>('mix-history', history => [...(history ?? []), entry]),
  getSettings: () => get<Settings>('settings'),
  saveSettings: (settings: Settings) => put('settings', settings),
}
