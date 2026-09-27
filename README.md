# Pinto

A mobile-first, on-device PWA for estimating oil-paint mixes from a reference photo using the fixed Royal Talens Van Gogh basic-oil catalogue.

## Privacy and limits

Photos are decoded, analysed, and stored only in the browser (Canvas, Web Worker, IndexedDB). Pinto has no server or upload path. Mixes are deterministic CIELAB colour estimates from photographed RGB—not measurements of physical pigment behaviour, lighting, opacity, or a calibrated Kubelka–Munk model.

## Development

```sh
npm install
npm run dev
npm run test
npm run test:e2e
npm run build
```

The GitHub Pages workflow is in `.github/workflows/pages.yml`; enable Pages with GitHub Actions as its source in repository settings.
