# Pinto

A mobile-first, on-device PWA for estimating oil-paint mixes from a reference photo using the fixed Royal Talens Van Gogh basic-oil catalogue.

## Privacy and limits

Photos are decoded, analysed, and stored only in the browser with Canvas, a Web Worker, and IndexedDB. Pinto has no server or upload path. The catalogue is fixed for this MVP; its persisted snapshot is not editable. Mixes are deterministic CIELAB colour estimates from photographed RGB, not measurements of physical pigment behaviour, lighting, opacity, or a calibrated Kubelka–Munk model.

## Local development

Install dependencies, then start Vite's development server:

```sh
npm install
npm run dev
```

Run the unit tests, production build, and Playwright critical-flow suite with:

```sh
npm run test
npm run build
npm run test:e2e
```

`npm run test:e2e` builds the app and serves the production preview automatically before running Playwright.

The GitHub Pages workflow is in `.github/workflows/pages.yml`; enable Pages with GitHub Actions as its source in repository settings.
