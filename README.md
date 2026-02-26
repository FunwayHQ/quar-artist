<p align="center">
  <img src="public/logo.svg" alt="QUAR Artist" width="300" />
</p>

<h3 align="center">Professional Web-Based Digital Illustration</h3>

<p align="center">
  A fully client-side painting and illustration app built with PixiJS v8, React, and TypeScript.<br/>
  WebGPU-first rendering. No backend required.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/PixiJS-v8-E72264?style=flat-square" alt="PixiJS v8" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square" alt="TypeScript" />
  <img src="https://img.shields.io/badge/WebGPU-primary-76B900?style=flat-square" alt="WebGPU" />
  <img src="https://img.shields.io/badge/Tests-745_passing-brightgreen?style=flat-square" alt="Tests" />
</p>

---

## Features

### Brush Engine
- **Stamp-based rendering** — smooth strokes via Catmull-Rom spline interpolation
- **12 brush presets** across 5 categories: Draw, Paint, Sketch, Blend, Utility
- **Procedural textures** — 12 shape textures + 4 grain textures, deterministically generated
- **Pressure sensitivity** — opacity and size respond to pen pressure and tilt
- **Configurable smoothing** — per-brush stroke smoothing with exponential filter

### Layers
- Up to 20 layers with full compositing pipeline
- 8 blend modes: Normal, Multiply, Screen, Overlay, Soft Light, Add, Color, Luminosity
- Per-layer opacity, visibility, lock, alpha lock, and clipping masks
- Drag-and-drop reorder, duplicate, merge down
- Live thumbnail previews

### Color
- HSB color disc with classic picker
- Color harmony modes (complementary, analogous, triadic, split-complementary, tetradic)
- Custom palettes with CRUD operations
- Recent colors history
- Swap primary/secondary (X key)

### Selection & Transform
- Rectangle, ellipse, freehand lasso, and magic wand selection tools
- Selection modes: new, add, subtract, intersect (via Shift/Alt modifiers)
- Feather radius and magic wand tolerance controls
- Marching ants animation overlay
- Bilinear interpolation for smooth transforms

### Canvas Navigation
- Two-canvas architecture: PixiJS static canvas + HTML overlay
- Pinch-zoom, two-finger rotate, pan (Space+drag)
- Ctrl+wheel zoom, Shift+wheel horizontal scroll
- Coalesced and predicted pointer events for low-latency input

### Export & Persistence
- **Auto-save** to IndexedDB — debounced 5s after each stroke
- **Manual save** — Ctrl+S for immediate persistence
- **PNG** export — full-resolution composite
- **JPEG** export — with quality slider (Low/Medium/High/Max)
- **PSD** export — layers preserved with blend mode mapping via ag-psd
- **.qart** format — portable ZIP archive with manifest + per-layer pixel data
- **.qart** import — restore projects from exported files
- **Gallery view** — project grid with thumbnails, create/open/delete/duplicate

### Undo/Redo
- Full-layer snapshot undo with 50-state history
- Supports both layer (stroke) and selection undo entries
- Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Rendering** | PixiJS v8 (WebGPU primary, WebGL 2.0 fallback) |
| **UI** | React 19 + TypeScript (strict) |
| **State** | Zustand |
| **Build** | Vite 7 |
| **Persistence** | IndexedDB via [idb](https://github.com/jakearchibald/idb) |
| **PSD I/O** | ag-psd |
| **Archive** | JSZip |
| **Icons** | Lucide React |
| **DnD** | @dnd-kit |
| **Tests** | Vitest + Testing Library |

---

## Getting Started

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npx vitest run

# Run a single test file
npx vitest run src/engine/brush/BrushEngine.test.ts

# Type check
npx tsc --noEmit

# Build for production
npm run build
```

---

## Architecture

```
src/
├── engine/            # Imperative rendering engine (no React imports)
│   ├── brush/         # BrushEngine, StrokeSmoother, PathInterpolator, BrushTextureManager
│   ├── canvas/        # CanvasManager (orchestrator), ViewTransform
│   ├── input/         # InputManager (pointer, gesture, keyboard)
│   ├── layers/        # LayerManager, LayerCompositor, TileManager
│   ├── selection/     # SelectionManager, SelectionController, tool implementations
│   ├── transform/     # TransformManager with bilinear interpolation
│   ├── shaders/       # GLSL ES 3.0 + WGSL blend mode shaders
│   ├── undo/          # UndoManager (layer + selection entries)
│   └── renderer.ts    # PixiJS init (WebGPU → WebGL fallback)
├── components/        # React UI components
│   ├── shell/         # TitleBar, ToolBar, BrushControls, CanvasViewport
│   ├── layers/        # LayersPanel, LayerRow (sortable)
│   ├── color/         # ColorPanel, ColorDisc, ClassicPicker, Harmony, Palettes
│   ├── gallery/       # GalleryView, ProjectCard
│   └── dialogs/       # NewProjectDialog, ExportDialog
├── stores/            # Zustand stores (tool, brush, color, layer, ui, selection, project)
├── db/                # IndexedDB schema via idb
├── io/                # File I/O and persistence
│   ├── persistence/   # MetadataDB, AutoSave
│   └── formats/       # .qart (ZIP), PSD (ag-psd), PNG/JPEG
├── hooks/             # useEngine (React↔Engine bridge)
├── types/             # TypeScript type definitions
└── styles/            # Global CSS tokens and design system
```

**Key architectural rule:** `src/engine/` has zero React imports. The engine is pure imperative code. React communicates with the engine through Zustand stores and callback subscriptions.

---

## Design System

**Neo-Industrial Studio** — warm amber accents on dark charcoal with glass panel effects.

- **Accent:** `#F59E0B` (amber)
- **Background:** `#0a0a0b` (warm charcoal)
- **Glass:** Frosted glass panels with `backdrop-filter: blur(12px)`
- **Typography:** DM Sans (UI) + IBM Plex Mono (values)
- **Icons:** Lucide React, stroke 1.5px

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Z | Undo |
| Ctrl+Shift+Z / Ctrl+Y | Redo |
| Ctrl+S | Save |
| Ctrl+A | Select All |
| Ctrl+D | Deselect |
| Ctrl+Shift+I | Invert Selection |
| X | Swap Colors |
| Space+Drag | Pan Canvas |
| Ctrl+Wheel | Zoom |
| Shift+Wheel | Horizontal Scroll |

---

## Sprint Progress

| Sprint | Status | Focus |
|--------|--------|-------|
| 1 — Scaffolding & Canvas | Done | Vite, PixiJS, two-canvas, gestures |
| 2 — Brush Engine | Done | Stamp rendering, smoothing, interpolation, undo |
| 3 — Layer System | Done | Layer CRUD, compositing, blend modes |
| 4 — Brushes & Color | Done | 12 presets, HSB picker, harmony, palettes |
| 5 — Selection & Transform | Done | Rect/ellipse/lasso/wand, marching ants, bilinear |
| 6 — Export & Persistence | Done | IndexedDB, PNG/JPEG/PSD/.qart, gallery |
| 7 — Filters | Planned | Blur, sharpen, HSB adjust, curves |
| 8 — Performance | Planned | WASM, tile streaming, WebWorkers |
| 9 — Polish | Planned | Onboarding, accessibility, PWA |

---

## License

Part of the [QUAR Suite](https://quar.pro) by FunwayHQ.
