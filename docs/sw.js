const CACHE = 'pinto-shell-v2'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg']

async function builtAssets() {
  try {
    const manifest = await fetch('./.vite/manifest.json', { cache: 'no-store' }).then(response => response.json())
    return ['./.vite/manifest.json', ...Object.values(manifest).flatMap(entry => [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]).map(asset => `./${asset}`)]
  } catch {
    return []
  }
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE)
  await cache.addAll([...SHELL, ...await builtAssets()])
  await self.skipWaiting()
})()))

self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim()
})()))

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('./index.html')))
    return
  }
  event.respondWith(caches.match(event.request).then(cached => cached ?? fetch(event.request).then(response => {
    if (response.ok) void caches.open(CACHE).then(cache => cache.put(event.request, response.clone()))
    return response
  })))
})
