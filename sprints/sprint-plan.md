# QUAR Artist — Sprint Plan

## Overview

Phase 1 MVP: 9 sprints across 18 weeks (Months 1–6) — **fully client-side, no backend**
Phase 2 v1.0: 6 sprints across 12 weeks (Months 7–9) — adds collaboration server, cloud save
Phase 3 v2.0: Scoped later based on MVP learnings

Each sprint is 2 weeks. Each sprint section below includes a detailed LLM prompt ready to execute.

**MVP constraint:** No backend server. All persistence is local (IndexedDB via Dexie.js + OPFS for tile data). Users save work locally and export as .qart file, PNG, JPEG, or PSD. Collaboration and cloud features are Phase 2.

---

## Phase 1: MVP

### Sprint 1 — Project Scaffolding & Canvas Bootstrap (Weeks 1–2)

**Goal:** Standing Vite+React+TypeScript+PixiJS project with a working WebGPU/WebGL canvas that handles zoom/pan gestures.

**Deliverables:**
- Vite 5 + React 18 + TypeScript (strict) project scaffold
- PixiJS v8 integrated with WebGPU primary / WebGL 2.0 fallback detection
- Two-canvas architecture: static canvas (PixiJS) + interactive overlay canvas
- Canvas component with `desynchronized: true` hint
- Pointer Events gesture handling: pinch-zoom, two-finger rotate, pan (Space+drag)
- Zustand stores skeleton: toolStore, uiStore
- ESLint + Prettier config with architecture boundary rules
- Tailwind CSS setup (dark theme default)
- Basic app shell: centered canvas with minimal top bar

**LLM Prompt:**

```
You are building QUAR Artist, a professional web-based digital illustration app. This is Sprint 1: project scaffolding and canvas bootstrap.

CONTEXT:
- Read agents/project-architect.md for build config and architecture rules
- Read agents/rendering-engine.md for the two-canvas architecture
- Read agents/frontend-designer.md for UI stack decisions and the full Neo-Industrial Studio design system
- Read quar-suite-design-prompt.md for the authoritative design tokens, layout specifications, and component library
- Read CLAUDE.md for full tech stack reference

TASKS:
1. Scaffold a Vite 5 + React 18 + TypeScript project:
   - tsconfig with strict: true, path aliases (@engine/*, @components/*, @stores/*, @types/*)
   - Separate tsconfig for src/engine (no React/JSX)
   - ESLint config with import/no-restricted-paths enforcing: engine cannot import react or components
   - Prettier config
   - CSS Modules with CSS custom properties (NOT Tailwind — the design system uses its own token system)

2. Install and configure PixiJS v8:
   - Create src/engine/renderer.ts that initializes PixiJS Application
   - Detect WebGPU support (navigator.gpu), fall back to WebGL 2.0
   - Apply desynchronized: true canvas hint
   - Log which backend is active to console

3. Implement the two-canvas architecture:
   - Static canvas: PixiJS Application canvas (bottom layer, holds artwork)
   - Interactive canvas: HTML canvas overlay (top layer, transparent, for cursor/selection)
   - Both canvases sized identically, stacked via CSS position: absolute
   - Create src/engine/canvas/CanvasManager.ts managing both canvases

4. Implement gesture handling in src/engine/input/InputManager.ts:
   - Pointer Events for all input
   - Pinch-zoom via two-pointer distance tracking
   - Two-pointer rotate via angle between pointers
   - Pan via Space+drag (keyboard modifier) or two-finger drag
   - Mouse wheel zoom
   - Store canvas transform (zoom, rotation, panX, panY) in src/engine/canvas/ViewTransform.ts

5. Create Zustand store skeletons:
   - src/stores/toolStore.ts (activeTool, setTool)
   - src/stores/uiStore.ts (panel visibility, fullscreen)

6. Set up the Neo-Industrial Studio design system:
   - Create src/styles/tokens.css with the full :root CSS custom properties block from quar-suite-design-prompt.md Section 2
   - Add Quar Artist amber accent overrides from Section 3
   - Install @fontsource/dm-sans (400, 500, 600) and @fontsource/ibm-plex-mono (400, 500)
   - Add body::before noise texture overlay (fractal noise at 1.5% opacity)
   - Add glass panel utility class: backdrop-filter: blur(12px) saturate(150%), rgba(17,17,19,0.85) bg
   - Implement 6px scrollbar styling with rgba(255,255,255,0.1) thumbs

7. Build minimal app shell following layout spec from quar-suite-design-prompt.md Section 5:
   - src/App.tsx with full-viewport canvas area
   - Title bar: 28px, glass surface, "QUAR Artist" + ··· overflow menu
   - Left tool bar: 48px wide placeholder (vertical icon strip)
   - Right shelf: 48px wide placeholder (color disc + sliders)
   - Canvas: full-bleed, bg-canvas (#09090a), takes all remaining space
   - No bottom bar on desktop — clean canvas edge

8. Verify:
   - npm run dev starts without errors
   - Canvas renders on #09090a background
   - Title bar has glass surface effect with noise overlay visible
   - DM Sans font loads for UI text
   - Amber accent color (#F59E0B) present in any active/focused elements
   - Pinch/zoom/pan gestures work
   - Console shows "WebGPU initialized" or "WebGL 2.0 fallback"

ARCHITECTURE RULES:
- src/engine/ must have ZERO React imports
- React components interact with engine only through stores or hooks
- All rendering logic in engine, all UI in components
```

---

### Sprint 2 — Basic Brush Engine & Single-Layer Painting (Weeks 3–4)

**Goal:** Paint on a single layer with 3 brushes using mouse or pen, with pressure/tilt support and basic undo/redo.

**Deliverables:**
- Stamp-based brush rendering pipeline (PointerEvent → smoothing → spline → stamps → FBO)
- `getCoalescedEvents()` and `getPredictedEvents()` integration
- 3 initial brushes: round pen, soft airbrush, hard eraser
- Pressure → size/opacity mapping via PointerEvent.pressure
- Tilt mapping via tiltX/tiltY
- StreamLine stroke smoothing (exponential smoothing, configurable alpha)
- Single-layer FBO rendering
- Tile-based undo/redo (256x256 dirty tile tracking, 50 states)
- Brush size/opacity sliders in UI
- Keyboard: Ctrl+Z undo, Ctrl+Shift+Z redo

**LLM Prompt:**

```
You are building QUAR Artist Sprint 2: the brush engine and single-layer painting.

CONTEXT:
- The project scaffold from Sprint 1 is in place (Vite+React+TS+PixiJS v8)
- Read agents/rendering-engine.md for the full brush pipeline architecture
- Read agents/state-management.md for the engine↔React bridge pattern
- The PRD section 4.1 and 5.2.1 describe the stamp-based brush rendering pipeline

TASKS:
1. Create src/engine/brush/BrushEngine.ts:
   - Stamp-based rendering: each stroke = sequence of textured quads along a spline path
   - Input: array of {x, y, pressure, tiltX, tiltY, timestamp} points
   - For each stamp position, render a textured quad to the active layer's PixiJS RenderTexture
   - Stamp parameters derived from pressure/tilt: size = baseSize * pressureCurve(pressure), opacity = baseOpacity * pressure

2. Create src/engine/brush/StrokeSmoother.ts:
   - Implement exponential smoothing (StreamLine): S_t = α × P_t + (1 − α) × S_{t-1}
   - Configurable α (0 = maximum smoothing, 1 = no smoothing)
   - Accept raw points, output smoothed points

3. Create src/engine/brush/PathInterpolator.ts:
   - Catmull-Rom spline interpolation between smoothed points
   - Generate stamp positions at configured spacing (e.g., spacing = 0.25 means stamps overlap 75%)
   - Each stamp position includes interpolated pressure/tilt values

4. Create src/engine/input/InputManager.ts updates:
   - Capture pointerdown/pointermove/pointerup on canvas
   - Use getCoalescedEvents() for high-frequency intermediate points (with fallback)
   - Use getPredictedEvents() for drawing-ahead (render predicted, then correct on next real event)
   - Pass point arrays to BrushEngine
   - Implement touch rejection: ignore touch when pointerType === 'pen'

5. Implement 3 brush presets in src/engine/brush/BrushParams.ts:
   - Round Pen: hard edge, size 5-50px, full opacity, tight spacing (0.1)
   - Soft Airbrush: gaussian falloff alpha texture, size 20-200px, low opacity (0.3), spacing 0.05
   - Hard Eraser: uses destination-out composite, hard edge, size 10-100px
   - Each preset is a BrushParams object with: shapeTexture, size, opacity, spacing, pressureSizeMapping, pressureOpacityMapping, isEraser

6. Create src/engine/undo/UndoManager.ts:
   - Before each stroke, snapshot affected 256x256 tiles from the layer RenderTexture
   - After stroke, snapshot same tiles
   - Store {before: Map<tileKey, Uint8Array>, after: Map<tileKey, Uint8Array>} per operation
   - Undo: restore "before" tiles; Redo: restore "after" tiles
   - Stack depth: 50 states
   - Tile extraction: use PixiJS extract to read pixel data from RenderTexture regions

7. Create src/engine/layers/TileManager.ts:
   - Track which tiles are dirty per operation
   - Tile key format: "tileX_tileY" where tileX = floor(pixelX / 256)
   - Only process tiles that the brush stroke actually touched

8. Update UI:
   - Add brush size slider (1-500) and opacity slider (0-100%) to top bar
   - Wire sliders to Zustand brushStore
   - brushStore actions call engine.setBrushParams()
   - Add Ctrl+Z / Ctrl+Shift+Z keyboard shortcut handling

9. Verify:
   - Draw smooth strokes with mouse (varying speed)
   - If pen tablet available: pressure affects size/opacity
   - Switch between 3 brushes
   - Undo removes last stroke, redo restores it
   - 50 undo levels work without excessive memory growth
```

---

### Sprint 3 — Layer System (Weeks 5–6)

**Goal:** Full layer panel with create/delete/reorder, opacity, visibility, blend modes, alpha lock, and clipping masks.

**Deliverables:**
- LayerManager: create, delete, reorder, duplicate, merge down (up to 20 layers)
- Per-layer FBO (PixiJS RenderTexture) with sparse tile tracking
- 8 blend modes: Normal, Multiply, Screen, Overlay, Soft Light, Add, Color, Luminosity
- Blend mode fragment shaders (WGSL + GLSL fallback)
- Alpha lock and clipping mask per layer
- Layer compositor: bottom-to-top FBO compositing
- Layers panel UI: thumbnail preview, drag-to-reorder, visibility/lock toggles, opacity slider, blend mode dropdown
- Layer metadata persisted in Zustand layerStore

**LLM Prompt:**

```
You are building QUAR Artist Sprint 3: the layer system.

CONTEXT:
- Sprints 1-2 are complete: scaffold + single-layer brush painting with undo
- Read agents/rendering-engine.md sections on Layer Compositor and Tile-Based Sparse Layers
- Read agents/state-management.md for the LayerStore schema
- Read agents/frontend-designer.md for the Layers Panel UI spec with Neo-Industrial Studio styling
- Read quar-suite-design-prompt.md Section 8 for the exact Layer Panel layout, interactions, and swipe gestures
- PRD sections 4.3 (Layer System) and 5.2.2 (Layer Compositor)

TASKS:
1. Create src/engine/layers/LayerManager.ts:
   - Each layer = { id, PixiJS RenderTexture (FBO), TileManager instance, metadata }
   - Operations: createLayer, deleteLayer, duplicateLayer, reorderLayers, mergeDown
   - Merge down: composite source layer onto layer below using blend mode, then delete source
   - Maximum 20 layers (MVP limit)
   - Active layer receives brush strokes

2. Create src/engine/layers/LayerCompositor.ts:
   - Composite all visible layers bottom-to-top into the static canvas
   - For "Normal" blend mode: use PixiJS built-in alpha blending
   - For custom blend modes: apply custom fragment shader during compositing
   - Call compositor after every stroke completion and layer metadata change
   - Skip invisible layers, respect opacity

3. Implement 8 blend mode shaders in src/engine/shaders/blend/:
   - Normal (built-in), Multiply, Screen, Overlay, Soft Light, Add, Color, Luminosity
   - Each as a PixiJS Filter with custom fragment shader
   - WGSL for WebGPU, GLSL ES 3.0 for WebGL fallback
   - Shader reads source (current layer) and destination (layers below) pixels

   Formulas:
   - Multiply: result = src * dst
   - Screen: result = 1 - (1-src) * (1-dst)
   - Overlay: result = dst < 0.5 ? 2*src*dst : 1 - 2*(1-src)*(1-dst)
   - Soft Light: result = dst < 0.5 ? src*(2*dst + src*(1-2*dst)) : ... (Photoshop formula)
   - Add: result = min(src + dst, 1.0)
   - Color: result = HSL(hue(src), sat(src), lum(dst))
   - Luminosity: result = HSL(hue(dst), sat(dst), lum(src))

4. Implement alpha lock:
   - When enabled, painting only affects pixels where layer already has alpha > 0
   - Implementation: before stamp render, read destination alpha; multiply stamp alpha by destination alpha

5. Implement clipping masks:
   - A clipping mask layer is visible only where the layer below has alpha > 0
   - Implementation: during compositing, multiply clipping layer alpha by base layer alpha

6. Update undo system:
   - UndoManager now tracks which layer the operation occurred on
   - Undo/redo restores tiles to the correct layer's RenderTexture

7. Build Layers Panel UI per quar-suite-design-prompt.md Section 8 (src/components/layers/):
   - LayersPanel.tsx: slide-in from right, 300px wide, glass surface
   - Header: [+ Layer] [+ Group] [Merge ▾] [···]
   - LayerRow.tsx: contains:
     - Thumbnail (40x40, checkerboard for transparency, --radius-sm, 1px --color-border-subtle)
     - Layer name (editable on double-click)
     - Blend mode inline dropdown (--font-size-xs)
     - Opacity value (IBM Plex Mono, scrub-to-adjust)
     - Visibility eye icon toggle
   - Groups: collapsible with role="tree" and aria-expanded
   - Drag-to-reorder: 4px grab handle on left edge, drop indicator = 2px amber line, spring animation (200ms --easing-spring)
   - Touch: swipe left reveals Delete/Duplicate/Lock buttons; long press enters multi-select with checkboxes; two-finger tap toggles alpha lock
   - Bottom section: Blend Mode dropdown, Opacity slider, Alpha Lock / Clipping Mask / Reference / Mask toggles
   - Use @dnd-kit/sortable for drag-and-drop

8. Wire to Zustand layerStore:
   - All layer operations go through store actions
   - Store actions call engine.createLayer(), engine.deleteLayer(), etc.
   - Engine emits 'layerThumbnailUpdated' event → store updates thumbnail URLs
   - Use subscribeWithSelector so only changed layers re-render

9. Verify:
   - Create 5+ layers, paint on different layers
   - Toggle visibility, see layers appear/disappear
   - Change blend mode on a layer, see compositing change in real-time
   - Drag to reorder layers
   - Alpha lock prevents painting outside existing content
   - Clipping mask clips to layer below
   - Merge down combines two layers correctly
   - Undo/redo works across layer operations
```

---

### Sprint 4 — Brush Expansion & Color Picker (Weeks 7–8)

**Goal:** Expand to 10-15 brushes with brush preset system, and build the full color picker (disc, classic, harmony, palettes).

**Deliverables:**
- 12 brush presets: pencil, ink, watercolor, oil, marker, pastel, smudge, flat, round, airbrush, charcoal, eraser
- Brush preset system with shape/grain texture loading
- Brush preset quick-picker strip in toolbar
- HSB color disc (interactive wheel + SV center)
- Classic picker (hue bar + SV square)
- Value sliders (HSB / RGB / Hex)
- Color harmony modes (complementary, analogous, triadic, split-comp, tetradic)
- Color palette manager (create, add swatches, delete, import/export JSON)
- Recent colors strip (last 10)

**LLM Prompt:**

```
You are building QUAR Artist Sprint 4: brush expansion and color picker.

CONTEXT:
- Sprints 1-3 complete: scaffold, brush engine with 3 brushes, layer system with 8 blend modes
- Read agents/rendering-engine.md for brush stamp shader architecture
- Read agents/frontend-designer.md for Color Panel and Brush Settings specs
- Read agents/state-management.md for BrushStore and ColorStore schemas
- PRD section 4.1 (Brush Engine) and 4.5 (Color Tools)

IMPORTANT DESIGN CONTEXT:
- Read quar-suite-design-prompt.md for color picker layout (Section 7), brush UI (Section 6), and component specs (Section 12)
- Color disc must follow the exact layout from Section 7: 4px hue ring, SB square inside, primary/secondary swatches with X key swap
- Brush library panel: slide-in from left, 320px wide, with categories from Section 6
- All UI uses the Neo-Industrial Studio design tokens (amber accent, glass panels, DM Sans font)

TASKS — BRUSHES:
1. Create brush shape textures (src/assets/brushes/shapes/):
   - Generate procedurally or load PNG textures for: hard-round, soft-round, pencil-grain, ink-splatter, watercolor-bleed, oil-bristle, marker-flat, pastel-rough, charcoal-grain, smudge-soft, flat-square, airbrush-gradient
   - Each texture is a grayscale alpha map (white = opaque, black = transparent)

2. Create brush grain textures (src/assets/brushes/grains/):
   - paper-fine, paper-rough, canvas-weave, noise-perlin (4 grain textures for MVP)

3. Define 12 brush presets in src/engine/brush/presets.ts:
   - Each preset: { id, name, category, shapeTextureUrl, grainTextureUrl, size:{min,max,default}, opacity:{min,max,default}, spacing, pressureSizeCurve, pressureOpacityCurve, streamLine, isEraser, usesSmudge }
   - Pencil: hard shape + paper grain, size 2-20, high pressure sensitivity
   - Ink: ink-splatter shape, no grain, size 3-30, full opacity
   - Watercolor: watercolor-bleed shape + paper grain, size 20-150, low opacity with buildup
   - Oil: oil-bristle shape + canvas grain, size 10-100, medium opacity
   - Marker: marker-flat shape, no grain, size 10-80, flat opacity (low pressure sensitivity)
   - Pastel: soft shape + paper-rough grain, size 15-80, medium opacity
   - Smudge: soft-round shape, smudge mode (blend existing pixels), size 20-100
   - Others: flat, round, airbrush, charcoal, eraser with appropriate params

4. Update BrushEngine to load shape+grain textures:
   - Lazy-load textures on first use (PixiJS Assets.load)
   - Brush stamp fragment shader samples both shape and grain textures
   - Grain UV scrolls with stroke direction for natural feel

5. Build brush preset quick-picker:
   - Horizontal scrollable strip below the top bar or at top of right panel
   - Each preset: small icon (generated from shape texture) + name tooltip
   - Active preset highlighted
   - Wire to brushStore.setPreset()

TASKS — COLOR PICKER:
6. Build HSB Color Disc (src/components/color/ColorDisc.tsx):
   - Outer ring: hue wheel (0-360°)
   - Inner area: saturation (x-axis) × brightness (y-axis) square or triangle
   - Interactive: drag on wheel changes hue, drag in center changes S/B
   - Render with Canvas 2D (not React DOM for performance)
   - Shows harmony overlay dots when harmony mode is active

7. Build Classic Picker (src/components/color/ClassicPicker.tsx):
   - Vertical hue bar (drag to select hue)
   - Adjacent SV square (drag to select saturation + value)
   - Render with Canvas 2D

8. Build Value Sliders (src/components/color/ValueSliders.tsx):
   - HSB sliders (H: 0-360, S: 0-100, B: 0-100)
   - RGB sliders (R/G/B: 0-255)
   - Hex input field with validation
   - All modes are linked — changing one updates others

9. Implement color harmony (src/components/color/ColorHarmony.tsx):
   - Dropdown to select mode: none, complementary, analogous, triadic, split-complementary, tetradic
   - Formulas from PRD section 4.5:
     - Complementary: H_comp = (H + 180) % 360
     - Analogous: H ± 30
     - Triadic: H ± 120
     - Split-comp: H + 150, H + 210
     - Tetradic: H + 90, 180, 270
   - Harmony dots displayed on the color disc
   - Clicking a harmony dot sets it as primary color

10. Build Palette Manager (src/components/color/PaletteManager.tsx):
    - Grid of color swatches
    - Add current color to palette (+ button)
    - Delete swatch (right-click or long-press)
    - Create / rename / delete palettes
    - Import/export palette as JSON file
    - Wire to colorStore.palettes

11. Recent colors strip:
    - Last 10 unique colors shown as small swatches
    - Auto-populated when user picks a new color
    - Click to reselect

12. Wire everything to colorStore and engine:
    - colorStore.setPrimary() → engine.setColor() bridge
    - Brush engine uses current primary color for stamp rendering

VERIFY:
- Select each of 12 brushes, paint strokes with different characteristics
- Color disc: drag hue wheel, drag SV area, color updates live
- Switch between disc/classic/sliders, values stay synchronized
- Harmony mode shows correct companion colors
- Add colors to palette, close and reopen — palette persists
- Recent colors populate as you pick new colors
```

---

### Sprint 5 — Selection & Transform Tools (Weeks 9–10)

**Goal:** Rectangle, ellipse, freehand, and magic wand selection tools with freeform transform.

**Deliverables:**
- Selection mask system (per-pixel alpha mask stored as separate texture)
- Rectangle selection tool with drag + Shift for square
- Ellipse selection tool with drag + Shift for circle
- Freehand/lasso selection tool
- Magic wand (threshold-based flood fill selection)
- Selection feathering (adjustable edge softness)
- Add/subtract/intersect selection modifier keys (Shift/Alt)
- Freeform transform: move, scale, rotate selected region
- Bilinear interpolation for transform
- Marching ants animation on selection boundary (interactive canvas)
- Selection actions: select all, deselect, invert

**LLM Prompt:**

```
You are building QUAR Artist Sprint 5: selection and transform tools.

CONTEXT:
- Sprints 1-4 complete: full brush suite, layers, color picker
- Read agents/rendering-engine.md for the interactive canvas overlay architecture
- PRD section 4.4 (Selection & Transform Tools)

TASKS:
1. Create src/engine/selection/SelectionManager.ts:
   - Selection stored as a grayscale mask texture (same dimensions as canvas)
   - White = selected, black = unselected, gray = partial (feathered)
   - Methods: setMask, clearSelection, invertSelection, selectAll
   - Feathering: apply Gaussian blur to selection mask edges

2. Implement selection tools in src/engine/selection/tools/:
   - RectangleSelection.ts: pointerdown sets origin, pointermove draws rect, pointerup fills mask
     - Shift modifier constrains to square
   - EllipseSelection.ts: same pattern with elliptical fill
     - Shift constrains to circle
   - FreehandSelection.ts: capture path points, close path on pointerup, fill polygon in mask
   - MagicWandSelection.ts: flood fill from click point with configurable tolerance
     - Compare pixel colors in LAB space for perceptual accuracy
     - Tolerance slider (0-255)
     - "Contiguous" toggle (flood vs. all matching pixels)

3. Selection modifier keys:
   - Shift+click: add to existing selection (union)
   - Alt+click: subtract from selection
   - Shift+Alt+click: intersect with selection
   - No modifier: replace selection

4. Marching ants on interactive canvas:
   - Extract selection boundary contour from mask
   - Draw animated dashed line on the interactive canvas overlay
   - Animate dash offset with requestAnimationFrame (classic marching ants)

5. Create src/engine/transform/TransformManager.ts:
   - When selection exists and Transform tool activated:
     - Copy selected pixels from active layer into a temporary texture
     - Clear selected pixels from layer (store in undo)
     - Show bounding box with 8 handles (corners + edges) + rotation handle on interactive canvas
   - Drag operations:
     - Move: translate the temporary texture
     - Scale: drag corner handles (Shift for uniform)
     - Rotate: drag rotation handle (above top center)
   - Apply: composite transformed texture back onto layer at new position
   - Cancel: restore original pixels

6. Bilinear interpolation:
   - When scaling/rotating, use bilinear sampling in the fragment shader
   - Prevents pixelation on upscale, smooths rotated edges

7. Add selection tools to tool panel UI:
   - Selection tool group in toolbar (click-and-hold or dropdown to pick sub-tool)
   - Transform tool in toolbar
   - Selection options bar: feather radius slider, tolerance slider (magic wand), contiguous toggle
   - Selection actions: Select All (Ctrl+A), Deselect (Ctrl+D), Invert Selection (Ctrl+Shift+I)

8. Update undo system:
   - Selection changes are undoable operations
   - Transform apply is an undoable operation (stores affected tiles before/after)

VERIFY:
- Rectangle select a region, see marching ants
- Shift+rectangle selects square
- Magic wand selects contiguous color region with adjustable threshold
- Freehand lasso draws custom selection shape
- Feathering softens selection edges visibly when painting
- Transform: move, scale, rotate selected content
- Shift+scale maintains aspect ratio
- Undo reverses transform and selection operations
- Selection works correctly across layers
```

---

### Sprint 6 — Export & Project Persistence (Weeks 11–12)

**Goal:** Save/load projects locally, export PNG/JPEG/PSD/.qart, gallery view with project management. **No backend — everything is client-side.**

**Deliverables:**
- Local auto-save to IndexedDB (Dexie.js for metadata) + OPFS (tile data) — debounced 5s after stroke
- Manual save (Ctrl+S) — same as auto-save but immediate
- .qart file export (ZIP: JSON manifest + LZ4 tile chunks) — user downloads the file
- .qart file import — user opens a .qart file from disk
- PNG export with full-resolution composite
- JPEG export with quality slider
- PSD export via ag-psd (layers preserved)
- Gallery view: project grid with thumbnails, create/open/delete/duplicate
- New project dialog: canvas size presets + custom, DPI selector
- Project persistence via Dexie.js (metadata) + OPFS (pixel data)

**LLM Prompt:**

```
You are building QUAR Artist Sprint 6: export and project persistence.

IMPORTANT: The MVP is fully client-side with NO backend server. All persistence is local browser storage. Users export .qart files to disk as their portable save format.

CONTEXT:
- Sprints 1-5 complete: painting, layers, color, selection/transform
- Read agents/file-io.md for the complete file I/O architecture
- Read agents/state-management.md for ProjectStore and persistence layer
- PRD sections 4.9 (Export & File Management) and 5.5 (File I/O & Persistence)

TASKS:
1. Set up Dexie.js database (src/db/schema.ts):
   - projects table: id, name, width, height, dpi, createdAt, updatedAt, thumbnailBlob
   - brushPresets table: id, name, category, params (JSON), isDefault
   - palettes table: id, name, colors (JSON), isDefault
   - settings table: key-value store

2. Set up OPFS persistence worker (src/workers/persistence.worker.ts):
   - Worker receives messages: saveTiles, loadTiles, deleteTiles
   - File structure in OPFS: /projects/{projectId}/layers/{layerId}/{tileX}_{tileY}.bin
   - Tiles are LZ4 compressed before writing (use lz4js pure JS for MVP, WASM later)

3. Implement auto-save (src/io/persistence/AutoSave.ts):
   - After each stroke completes, start 5-second debounce timer
   - On trigger: collect dirty tiles from all layers → send to persistence worker
   - Update project metadata in Dexie (updatedAt, thumbnailBlob)
   - Update projectStore.lastSaved
   - Show subtle "Saved" indicator in UI that fades after 2s

4. Implement manual save (Ctrl+S):
   - Same as auto-save but immediate, no debounce
   - Prevent browser default save dialog

5. Implement project loading:
   - Read project metadata from Dexie
   - Load tile data from OPFS via worker
   - Reconstruct layer RenderTextures from tile data
   - Restore layer metadata (order, blend modes, opacity, etc.)

6. Implement PNG export (src/io/formats/image/ImageExporter.ts):
   - Composite all visible layers to a temporary PixiJS RenderTexture
   - Extract as Blob via canvas.toBlob('image/png')
   - Trigger download with project name

7. Implement JPEG export:
   - Same composite step
   - canvas.toBlob('image/jpeg', quality) with quality slider (0.1-1.0)

8. Implement PSD export (src/io/formats/psd/PsdExporter.ts):
   - Run in Web Worker to avoid blocking
   - For each layer: extract full pixel data as ImageData
   - Map QUAR blend modes to PSD blend modes
   - Call ag-psd writePsd() with layer array
   - Return Blob for download

9. Implement .qart file export (src/io/formats/qart/QartWriter.ts):
   - Build manifest.json from project metadata (canvas size, DPI, layer stack)
   - For each layer: read tiles from OPFS, LZ4 compress each tile
   - Package everything into a ZIP archive via JSZip
   - Trigger download as {projectName}.qart
   - This is the user's portable save format — they can back up, share, or move projects between machines

10. Implement .qart file import (src/io/formats/qart/QartReader.ts):
    - User selects a .qart file via file input or drag-and-drop
    - Extract ZIP, parse manifest.json
    - For each layer: decompress LZ4 tile data, write to OPFS
    - Create project entry in Dexie
    - Open the imported project in canvas view

11. Build Export Dialog (src/components/dialogs/ExportDialog.tsx):
    - Format tabs: PNG | JPEG | PSD | QART
    - PNG: dimensions display, download button
    - JPEG: quality slider (Low/Medium/High/Max presets + custom), dimensions
    - PSD: layer count display, estimated file size, download button
    - QART: full project save with all layers/metadata, download button
    - Preview thumbnail of what will be exported

12. Build Gallery View (src/components/gallery/):
    - GalleryView.tsx: grid of ProjectCard components
    - ProjectCard.tsx: thumbnail, name, last modified date, canvas dimensions
    - Click to open project (loads into canvas)
    - Right-click/long-press context menu: rename, duplicate, delete
    - "New Project" card with + icon

13. Build New Project Dialog (src/components/dialogs/NewProjectDialog.tsx):
    - Canvas size presets: 1080x1080, 1920x1080, 2048x2048, 4096x4096, A4 300dpi, custom
    - Width/height inputs with link toggle (maintain aspect ratio)
    - DPI selector: 72, 150, 300, custom
    - Color space: sRGB (default)
    - Create button → creates project in Dexie, initializes OPFS storage, opens canvas

14. Navigation:
    - App starts in Gallery view if no project is open
    - Back arrow in canvas view returns to Gallery
    - Opening a project transitions from Gallery to Canvas view

VERIFY:
- Create a new project with custom dimensions
- Paint on multiple layers
- Close and reopen — all artwork preserved (auto-save to IndexedDB + OPFS)
- Export PNG — correct dimensions, all layers composited
- Export JPEG — quality slider affects file size
- Export PSD — opens in Photoshop/Photopea with correct layers and blend modes
- Export .qart — downloads a .qart ZIP file
- Import .qart — open exported file, all layers and artwork restored correctly
- Gallery shows all projects with thumbnails
- Duplicate a project, delete a project
- Ctrl+S triggers immediate local save
- Everything works offline (no network requests needed for any save/export)
```

---

### Sprint 7 — Core Adjustments & Filters (Weeks 13–14)

**Goal:** Gaussian blur, sharpen, HSB adjustment, and curves filters applied to layers.

**Deliverables:**
- Filter application system (layer mode: apply to entire layer)
- Gaussian blur: adjustable radius, separable 2-pass GPU shader
- Sharpen: unsharp mask with amount/radius/threshold
- Hue/Saturation/Brightness adjustment with live preview
- Curves: RGB + per-channel with draggable control points, LUT-based shader
- ColorDrop flood fill tool with drag-to-adjust threshold
- Eyedropper tool (Alt+click, EyeDropper API where supported)
- Non-destructive preview (apply on confirm, cancel restores original)

**LLM Prompt:**

```
You are building QUAR Artist Sprint 7: core adjustments and filters.

CONTEXT:
- Sprints 1-6 complete: full painting workflow with persistence and export
- Read agents/rendering-engine.md for filter shader architecture
- PRD section 4.7 (Adjustments & Filters) and section 4.5 (Color Tools — ColorDrop, Eyedropper)

TASKS:
1. Create src/engine/filters/FilterManager.ts:
   - Manages filter application to layers
   - Non-destructive preview: apply filter to a temporary RenderTexture copy
   - On confirm: replace layer RenderTexture with filtered version (undoable)
   - On cancel: discard temporary, restore original

2. Gaussian Blur shader (src/engine/shaders/filters/gaussian.wgsl + .frag):
   - Separable 2-pass: horizontal blur → vertical blur
   - Radius parameter (1-100 pixels)
   - Dynamically sized kernel (kernel size = ceil(radius * 3) * 2 + 1)
   - Implement as PixiJS Filter
   - Live preview: adjust radius slider, see result in real-time on canvas

3. Sharpen shader (unsharp mask):
   - Apply Gaussian blur, then: sharpened = original + amount * (original - blurred)
   - Parameters: amount (0-5), radius (0.1-10), threshold (0-255)
   - Threshold: only sharpen pixels where difference exceeds threshold

4. HSB Adjustment shader:
   - Convert RGB → HSL, adjust H/S/B, convert back
   - Parameters: hue shift (-180 to +180), saturation (-100 to +100), brightness (-100 to +100)
   - Live preview with sliders

5. Curves adjustment:
   - UI: CurvesEditor.tsx — 256x256 canvas with draggable control points
   - Tabs: RGB (master), Red, Green, Blue
   - Catmull-Rom spline through control points → generate 256-entry LUT
   - Shader samples LUT texture to remap each channel
   - Default: diagonal line (identity). User adds/moves points.

6. Build filter dialog UI (src/components/dialogs/FilterDialog.tsx):
   - Shows selected filter controls (sliders, curves editor)
   - Live preview toggle
   - Apply / Cancel buttons
   - Access from menu: Adjustments > Blur / Sharpen / Hue-Sat-Brightness / Curves

7. Implement ColorDrop flood fill tool:
   - Click on canvas → flood fill with current color
   - Drag after click to adjust tolerance (distance from click point = threshold)
   - Scanline flood fill algorithm (use WASM if available, else JS)
   - Respects active layer and selection mask
   - Undoable operation

8. Implement Eyedropper tool:
   - Alt+click (temporary switch from any tool): sample color under cursor
   - Read pixel from composited canvas at click position
   - Update colorStore.primary with sampled color
   - Show magnifier loupe around cursor during hold
   - Use EyeDropper API where supported (Chrome) as enhancement

9. Add to tool store and keyboard shortcuts:
   - ColorDrop tool: G key
   - Eyedropper: I key (dedicated), Alt+click (temporary from any tool)
   - Filter menu accessible from top menu bar

VERIFY:
- Gaussian blur: adjust radius, preview updates smoothly, apply saves to layer
- Cancel filter restores original
- Sharpen: visible edge enhancement on detailed artwork
- HSB: shift hue of entire layer, saturation increase/decrease visible
- Curves: drag control points, see color remapping in real-time
- ColorDrop: fill a region, drag to expand/contract fill area
- Eyedropper: Alt+click samples correct color, updates color picker
- All filter operations are undoable
```

---

### Sprint 8 — Keyboard Shortcuts & Responsive UI (Weeks 15–16)

**Goal:** Complete keyboard shortcut system, responsive panel layout, and UI polish for all screen sizes.

**Deliverables:**
- Full keyboard shortcut system with all standard mappings
- Shortcut reference modal (? key or menu)
- Responsive layout: collapsible sidebars, stacking panels on tablet/mobile
- Tool panel collapses to icon rail on narrow viewports
- Right panel tabs switch between Layers/Color/Brush on narrow viewports
- Fullscreen mode (F11 / button)
- Context menus (right-click on canvas, layers, swatches)
- Tooltips on all tool icons showing name + shortcut
- Loading states and transitions between Gallery ↔ Canvas views

**LLM Prompt:**

```
You are building QUAR Artist Sprint 8: keyboard shortcuts and responsive UI polish.

CONTEXT:
- Sprints 1-7 complete: full painting app with filters, layers, persistence
- Read agents/frontend-designer.md for the full Neo-Industrial Studio design system, layout specs, and animation timing
- Read quar-suite-design-prompt.md Section 5 (Layout), Section 10 (Gestures), Section 11 (Keyboard Shortcuts), Section 13 (Animation Timing), Section 17 (Accessibility)
- PRD section 4.2 (Keyboard shortcuts list)

TASKS:
1. Create src/hooks/useKeyboardShortcuts.ts:
   - Global keyboard event listener (keydown/keyup)
   - Modifier-aware: Ctrl/Cmd, Shift, Alt, Space
   - Temporary tool switching: hold Alt → eyedropper, release → return to previous tool
   - Hold Space → pan mode, release → return to previous tool
   - All shortcuts configurable (stored in settings DB, with defaults)

2. Standard shortcut mappings (from quar-suite-design-prompt.md Section 11):
   Tools: B=Brush, E=Eraser, S=Smudge, V=Move, G=Fill/Gradient, I=Eyedropper (also Alt+click), M=Marquee Select, L=Lasso, W=Magic Wand, T=Text, U=Shape, H=Hand (also Space+drag), Z=Zoom
   Colors: X=Swap primary/secondary, D=Reset to black/white, 1-0=Opacity 10%-100%
   Actions: Ctrl+Z=Undo, Ctrl+Shift+Z=Redo, Ctrl+S=Save, Ctrl+Shift+S=Save As, Ctrl+Shift+E=Export
   Selection: Ctrl+A=Select All, Ctrl+D=Deselect, Ctrl+Shift+I=Invert, Ctrl+T=Transform
   Brush: [/]=Size down/up, {/}=Hardness down/up
   Layers: Ctrl+Shift+N=New, Ctrl+G=Group, Ctrl+E=Merge Down, Ctrl+Shift+E=Flatten Visible
   View: F=Fullscreen, R=Rotate canvas (drag), Ctrl+0=Reset rotation+zoom, Tab=Toggle UI visibility
   Misc: ?=Show shortcuts reference, Escape=Deselect/cancel

3. Build ShortcutsModal (src/components/dialogs/ShortcutsModal.tsx):
   - Grouped by category: Tools, Actions, Brush, View, Layers
   - Searchable
   - Shows current key binding for each action
   - Opened with ? key or Help menu

4. Responsive layout updates (from quar-suite-design-prompt.md Section 5):
   - Desktop (>1024px): Title bar (28px glass) + left toolbar (48px) + canvas (full bleed) + right shelf (48px). No bottom bar.
   - Tablet/Touch: Full-screen canvas + floating draggable tool palette (2-column, 48px) + floating color disc + bottom context bar (auto-hide). No menu bar — use ··· overflow.
   - Auto-hide behavior: Panels fade to 10% opacity after 3s inactivity, reappear on hover/touch within 120ms
   - Panel slide-in: 250ms with --easing-default
   - Floating palettes: draggable, auto-dock to edges, double-tap to collapse to single icon

5. Fullscreen mode:
   - F key or button: hide all panels, maximize canvas (no F11 — use F per design prompt)
   - Tab key: toggle panel visibility in fullscreen
   - Minimal floating controls: current tool + color swatch + undo/redo

6. Context menus:
   - Right-click on canvas: Undo, Redo, Paste, Select All, Deselect
   - Right-click on layer: Duplicate, Delete, Merge Down, Alpha Lock, Clipping Mask
   - Right-click on color swatch: Edit, Delete, Copy Hex
   - Implement with Radix UI ContextMenu

7. Tooltips:
   - Every toolbar icon shows tooltip on hover: "Brush Tool (B)", "Eraser (E)", etc.
   - 500ms delay before showing
   - Position: to the right of left toolbar icons, below top bar items

8. Loading/transition states:
   - Gallery → Canvas: loading spinner while project loads from OPFS
   - Canvas → Gallery: save confirmation if unsaved changes
   - Export: progress indicator for PSD export
   - Auto-save indicator: subtle dot/text in top bar

9. Toast notifications:
   - "Project saved" — after manual/auto save
   - "Exported as PNG" — after successful export
   - "Layer deleted" — with Undo action button
   - Positioned bottom-center, auto-dismiss after 3s

VERIFY:
- All keyboard shortcuts work as documented
- ? opens shortcuts reference, searchable
- Resize browser: panels adapt at each breakpoint
- Tablet width: toolbar becomes icon rail, right panel overlays
- F11: all UI hides, Tab toggles panels
- Right-click context menus work on canvas, layers, swatches
- All icons have tooltips with shortcut keys
- Save/export shows appropriate feedback
```

---

### Sprint 9 — Performance Optimization & Cross-Browser Testing (Weeks 17–18)

**Goal:** Optimize tile-based rendering, reach performance targets, and validate across all target browsers. Public beta launch.

**Deliverables:**
- Tile-based sparse layer optimization: only allocate/render painted tiles
- Desynchronized canvas verification and latency measurement
- Memory profiling: 20 layers at 2048x2048 within 512MB GPU memory
- Performance instrumentation dashboard (dev mode)
- Service Worker for offline caching
- Cross-browser test suite (Chrome, Firefox, Safari, Edge, iPad Safari)
- Visual regression baseline screenshots
- Bundle size optimization (code splitting, tree shaking, lazy loading)
- Bug fixes from all previous sprints

**LLM Prompt:**

```
You are building QUAR Artist Sprint 9: performance optimization and cross-browser testing. This is the final MVP sprint before public beta.

CONTEXT:
- Sprints 1-8 complete: full MVP feature set
- Read agents/rendering-engine.md for performance targets
- Read agents/browser-testing.md for the full cross-browser test plan (including Section 10: Design System Compliance tests)
- Read agents/wasm-engineer.md for WASM optimization opportunities
- PRD section 5.7 (Performance Optimization) and section 8 (Web Platform Limitations)

TASKS — PERFORMANCE:
1. Tile-based sparse layer optimization:
   - Audit TileManager: ensure empty tiles are NOT allocated as full 256x256 textures
   - Empty tiles reference a single shared 1x1 transparent texture
   - During compositing, skip empty tiles entirely
   - Measure: 20 layers at 2048x2048 with typical fill (30% painted) should use <200MB GPU memory

2. Desynchronized canvas:
   - Verify desynchronized: true is active on the main PixiJS canvas
   - Measure input-to-pixel latency with performance.now() instrumentation:
     - Start timer on pointerdown
     - End timer after stamp is rendered to canvas (via requestAnimationFrame callback)
   - Target: <25ms desktop, <40ms tablet

3. Layer compositing performance:
   - Profile compositing loop with 20 visible layers at 2K resolution
   - Target: <16ms (maintain 60fps)
   - Optimization: cache composited result for non-dirty layers, only re-composite when a layer changes
   - Use PixiJS renderToTexture caching for inactive layer groups

4. Undo/redo memory optimization:
   - Audit undo stack memory usage over 100 operations
   - Implement OPFS offloading for undo states older than 20 operations
   - LZ4 compress all tile snapshots in undo stack
   - Target: undo stack for 100 operations < 100MB

5. Bundle size optimization:
   - Analyze bundle with rollup-plugin-visualizer
   - Code split: engine chunk, PSD chunk, FFmpeg chunk (lazy)
   - Tree shake unused PixiJS modules
   - Target: initial JS bundle < 200KB compressed

6. Service Worker (src/sw.ts):
   - Cache app shell (HTML, JS, CSS) for offline access
   - Cache brush textures and other static assets
   - Cache-first strategy (MVP is fully offline — no server API calls)

TASKS — CROSS-BROWSER TESTING:
7. Create Playwright E2E test suite (tests/e2e/):
   - app-launch.spec.ts: loads without errors in all browsers, canvas initializes
   - canvas-interaction.spec.ts: zoom, pan, basic stroke rendering
   - layers-panel.spec.ts: create/delete/reorder layers
   - color-picker.spec.ts: disc, classic, hex input
   - export.spec.ts: PNG/JPEG/PSD export triggers download
   - keyboard-shortcuts.spec.ts: Ctrl+Z, B, E, Space, etc.
   - responsive.spec.ts: layout at 1920x1080, 1024x768, 390x844

8. Cross-browser matrix:
   - Chrome latest (WebGPU path)
   - Firefox latest (WebGL fallback path)
   - Edge latest
   - Safari latest (test WebGPU + OPFS + IndexedDB)
   - iPad Safari (if CI supports)

9. Visual regression baselines:
   - Capture screenshots of: gallery, canvas with tools, layers panel, color picker, export dialog
   - Store in tests/visual/snapshots/ per browser

10. Performance CI check:
    - Lighthouse CI for initial load performance
    - Custom performance test: measure stroke latency, compositing time
    - Bundle size assertion: fail if > 200KB initial

TASKS — BUG FIXES:
11. Review and fix any known issues from Sprints 1-8:
    - Memory leaks (check with DevTools heap snapshots)
    - Race conditions in auto-save
    - Edge cases in selection + transform
    - Browser-specific rendering differences

VERIFY:
- Performance dashboard shows: stroke latency <25ms, compositing <16ms
- 20-layer project at 2K doesn't exceed memory targets
- All E2E tests pass in Chrome, Firefox, Edge
- Safari tests pass (with documented known limitations)
- Bundle size < 200KB initial compressed
- App works offline after first load (service worker)
- No console errors in any browser
```

---

## Phase 2: Version 1.0 (Selected Sprints)

### Sprint 10 — Advanced Blend Modes & Brush Studio (Weeks 19–20)

**Goal:** All 26 blend modes and the Brush Studio panel for deep brush customization.

**Deliverables:**
- Remaining 18 blend mode shaders (adding to the 8 from Sprint 3)
- Brush Studio modal with 6 parameter categories
- Custom pressure curve editor
- Brush preset save/export (.qbrush JSON format)

**LLM Prompt:**

```
You are building QUAR Artist Sprint 10: advanced blend modes and Brush Studio.

CONTEXT:
- MVP is complete (Sprints 1-9). This is Phase 2.
- 8 blend modes exist from Sprint 3. Implement the remaining 18.
- Read agents/rendering-engine.md shader section for blend mode formulas
- PRD section 4.3.1 (26 Blending Modes) and section 4.1 (Brush Studio parameters)

TASKS:
1. Implement remaining blend mode shaders (WGSL + GLSL):
   Darken group: Darken, Color Burn, Linear Burn, Darker Color
   Lighten group: Lighten, Color Dodge, Lighter Color
   Contrast group: Hard Light, Vivid Light, Linear Light, Pin Light, Hard Mix
   Difference group: Difference, Exclusion, Subtract, Divide
   Color group: Hue, Saturation (Color and Luminosity already done)
   Special: Pass Through (for groups)

   Each shader formula from Photoshop spec:
   - Linear Burn: result = src + dst - 1
   - Color Dodge: result = dst / (1 - src)
   - Vivid Light: src < 0.5 ? ColorBurn(dst, 2*src) : ColorDodge(dst, 2*(src-0.5))
   - Pin Light: src < 0.5 ? min(dst, 2*src) : max(dst, 2*(src-0.5))
   - Hard Mix: VividLight > 0.5 ? 1 : 0
   - Divide: result = dst / src
   - etc.

2. Build Brush Studio (src/components/brush/BrushStudio.tsx):
   - Full-screen modal or right panel expansion
   - 6 tabs: Stroke Path, Shape, Grain, Rendering, Dynamics, Stabilization
   - Stroke Path: spacing slider, jitter slider, taper start/end
   - Shape: texture preview grid, scatter, rotation (fixed/random/pressure/tilt)
   - Grain: texture preview grid, scale, depth, movement mode
   - Rendering: opacity, flow, wet edges toggle
   - Dynamics: speed→size mapping, speed→opacity mapping, curve editors
   - Stabilization: StreamLine slider, stabilization mode toggle
   - Live preview: test stroke area at bottom of studio

3. Pressure curve editor (src/components/brush/PressureCurveEditor.tsx):
   - 256x256 canvas showing input pressure (X) → output response (Y)
   - Draggable control points with Bezier curves
   - Presets: Linear, Light Touch, Heavy Hand, S-Curve
   - Applies to both size and opacity pressure mapping

4. Brush preset save/export:
   - Save modified brush as new preset to Dexie
   - Export as .qbrush file (JSON with embedded base64 textures)
   - Import .qbrush file

VERIFY:
- All 26 blend modes render correctly (compare against Photoshop reference)
- Brush Studio: each parameter tab works, live preview updates
- Pressure curve: custom curve changes how pressure affects stroke
- Save custom brush, close studio, select it from preset picker — works
- Export/import .qbrush preserves all parameters
```

---

### Sprint 11 — Drawing Guides & QuickShape (Weeks 21–22)

**Goal:** Grid, isometric, perspective, symmetry guides and QuickShape snapping.

**LLM Prompt:**

```
You are building QUAR Artist Sprint 11: drawing guides and QuickShape.

CONTEXT:
- Phase 2, building on complete MVP
- PRD section 4.6 (Drawing Assists & Shape Tools)

TASKS:
1. Drawing guide system (src/engine/guides/):
   - Guides render on the interactive canvas overlay (not on artwork)
   - GuideManager.ts: manages active guide, renders on overlay canvas
   - When a guide is active, brush stroke points are "snapped" or "assisted" toward guide geometry

2. Implement guides:
   - 2D Grid: configurable spacing (px), visible grid lines on overlay, optional snap-to-grid
   - Isometric Grid: 30°/60° angled grid lines, snap brush to nearest grid line
   - Perspective (1-point): single vanishing point, radial guide lines from VP, strokes gravitate toward VP lines
   - Perspective (2-point): two VPs on horizon line, guides radiate from both
   - Symmetry: vertical axis (mirror strokes left↔right), horizontal, quadrant (4-way), radial (N-fold)
     - Symmetry works by duplicating each brush stamp mirrored across the axis/axes

3. Guide rendering:
   - Semi-transparent colored lines on interactive canvas
   - Vanishing points as draggable handles
   - Symmetry axis as draggable line
   - Grid opacity and color configurable

4. QuickShape (src/engine/tools/QuickShape.ts):
   - Detect drawn shape after stroke completes (hold at end to trigger)
   - Recognized shapes: line, rectangle, ellipse, triangle, arc, polygon
   - Snap to perfect geometry (straight line, perfect circle, etc.)
   - Show edit nodes on snapped shape for adjustment
   - Filled or stroked, using current brush and color

5. Guide settings UI:
   - Drawing Guides panel/modal accessible from menu or toolbar
   - Toggle each guide type on/off
   - Configure parameters (grid spacing, VP positions, symmetry axis count)

VERIFY:
- 2D grid visible on canvas, strokes snap to grid when enabled
- Perspective 1-pt: vanishing point draggable, strokes follow radial lines
- Symmetry vertical: drawing on left half mirrors to right in real-time
- Radial symmetry with 6 axes creates mandala-like patterns
- QuickShape: draw rough circle → hold → snaps to perfect ellipse with edit handles
```

---

### Sprint 12 — Animation Assist (Weeks 23–24)

**Goal:** Frame-by-frame animation with onion skinning, timeline, and GIF/MP4 export.

**LLM Prompt:**

```
You are building QUAR Artist Sprint 12: Animation Assist.

CONTEXT:
- Phase 2
- PRD section 4.8 (Animation)
- Each frame is a layer group; onion skinning overlays adjacent frames at reduced opacity

TASKS:
1. Animation model (src/engine/animation/AnimationManager.ts):
   - Animation mode toggle: when active, each top-level layer group = one frame
   - Frame order = layer group order (bottom = frame 1)
   - Active frame = active layer group
   - Navigate frames: left/right arrow keys or timeline click

2. Onion skinning:
   - Render N previous frames at decreasing opacity (60%, 40%, 20%) tinted red/blue
   - Render N next frames at decreasing opacity tinted green/blue
   - Toggle on/off, configurable depth (1-5 frames each direction)
   - Rendered on static canvas behind active frame, above other frames

3. Timeline UI (src/components/animation/Timeline.tsx):
   - Horizontal strip at bottom of canvas (collapsible)
   - Each frame as a thumbnail cell
   - Click to select frame, drag to reorder
   - Add frame (+), duplicate frame, delete frame buttons
   - Playback controls: play, pause, stop, loop toggle, ping-pong toggle
   - FPS slider (1-60, default 12)

4. Playback engine:
   - setInterval at configured FPS, cycle through frames
   - Each frame: hide all layer groups, show current frame's group, composite
   - Stop on last frame (one-shot) or loop/ping-pong

5. Onion skin rendering:
   - When painting on frame N: composite frames N-1, N-2 at reduced opacity with color tint
   - Use PixiJS tint + alpha on the composited frame textures

6. Export:
   - GIF: render each frame to canvas → gifenc encodes animated GIF → download
   - MP4/WebM: render each frame → MediaRecorder API or FFmpeg.wasm → download
   - PNG sequence: render each frame → zip as PNGs → download

7. UI integration:
   - Animation mode toggle in top menu or toolbar
   - When active: Timeline panel appears at bottom, layers panel shows frames
   - When inactive: normal layer behavior

VERIFY:
- Toggle animation mode, each layer group becomes a frame
- Navigate frames with arrow keys and timeline click
- Onion skinning shows previous/next frames with correct tinting
- Play animation at 12fps, loops correctly
- Ping-pong mode bounces back and forth
- Export GIF with 10 frames, GIF plays correctly in viewer
- Export MP4/WebM, video plays in browser
```

---

### Sprint 13 — Real-Time Collaboration (Weeks 25–26)

**Goal:** Multi-user painting sessions with cursor presence and layer locking.

**LLM Prompt:**

```
You are building QUAR Artist Sprint 13: real-time collaboration.

CONTEXT:
- Phase 2
- Read agents/collaboration.md for the full Yjs architecture
- PRD section 5.6 (Collaboration Architecture)

TASKS:
1. Set up Yjs document (src/collaboration/YjsProvider.ts):
   - Y.Doc with yLayers (Y.Array) and yStrokes (Y.Array)
   - WebSocket provider connecting to relay server
   - IndexedDB persistence for offline support

2. Build relay server (server/collab-server.ts):
   - y-websocket server on configurable port
   - Room-based: each project = one room
   - Dockerfile for deployment

3. Stroke synchronization (src/collaboration/StrokeSync.ts):
   - On local stroke complete: serialize {userId, layerId, brushParams, points} → push to yStrokes
   - On remote stroke received: deserialize → replay through local brush engine
   - Points stored as delta-encoded Int16Arrays for compactness

4. Layer metadata sync (src/collaboration/LayerSync.ts):
   - Bind layer metadata (order, name, visibility, opacity, blend mode) to yLayers
   - Changes to yLayers → update local layerStore + engine
   - Local layer changes → update yLayers → broadcast

5. Cursor presence (src/collaboration/CursorPresence.ts):
   - Each user: name, color (assigned on join), cursor position, active tool
   - Broadcast cursor via Yjs awareness (throttled 30fps)
   - Render remote cursors on interactive canvas: colored dot + user name label

6. Layer locking (src/collaboration/LockManager.ts):
   - When user starts painting: set lockedBy on yLayer map
   - Other users see lock icon on that layer, cannot paint on it
   - Release lock on pointerup
   - Disconnection timeout: release lock after 5s if user disconnects

7. Collaboration UI:
   - "Share" button in top bar → generates shareable URL with room ID
   - Connected users avatars in top bar (colored circles with initials)
   - User count indicator
   - Connection status: green dot = connected, yellow = reconnecting, red = disconnected

8. Collaboration store (src/stores/collaborationStore.ts):
   - isCollaborating, roomId, connectedUsers, connectionStatus
   - startSession(projectId), endSession(), getShareLink()

VERIFY:
- Open app in two browser tabs/windows
- Share link from tab 1, open in tab 2
- Both see each other's cursors moving
- User A paints on layer 1 — stroke appears on User B's canvas
- Layer locked while User A paints — User B sees lock icon
- User A changes layer opacity — User B sees it update
- Disconnect User B (close tab), reconnect — state merges correctly
- Offline: paint while disconnected, reconnect → strokes sync
```

---

### Sprint 14 — Plugin API v1 (Weeks 27–28)

**Goal:** JavaScript/WASM plugin extension points for custom brushes, filters, and UI panels.

**LLM Prompt:**

```
You are building QUAR Artist Sprint 14: Plugin API v1.

CONTEXT:
- Phase 2
- PRD mentions JS/WASM plugin API for custom brushes, filters, and UI panels
- Figma's 10,000+ plugin ecosystem validates this approach

TASKS:
1. Plugin sandbox (src/plugins/PluginSandbox.ts):
   - Each plugin runs in a sandboxed iframe (origin-isolated)
   - Plugin communicates with host via postMessage API
   - Permission model: declare required permissions in manifest (canvas.read, canvas.write, layers.read, ui.panel)

2. Plugin manifest format (.qplugin/manifest.json):
   {
     "id": "com.example.my-brush",
     "name": "My Custom Brush",
     "version": "1.0.0",
     "type": "brush" | "filter" | "panel" | "action",
     "main": "index.js",
     "permissions": ["canvas.read", "canvas.write"],
     "ui": { "width": 300, "height": 400 } // optional panel dimensions
   }

3. Plugin Host API (exposed to plugin iframe via postMessage):
   - quarArtist.canvas.getPixels(layerId, rect) → ImageData
   - quarArtist.canvas.setPixels(layerId, rect, imageData)
   - quarArtist.layers.getAll() → LayerMeta[]
   - quarArtist.layers.getActive() → LayerMeta
   - quarArtist.color.getPrimary() → RGBAColor
   - quarArtist.ui.showPanel(html) — render plugin UI in sidebar
   - quarArtist.ui.showNotification(message)

4. Plugin types:
   - Brush plugin: provides custom stamp generation function
   - Filter plugin: receives ImageData, returns processed ImageData
   - Panel plugin: renders custom UI in a sidebar panel
   - Action plugin: single-run script (like Photoshop Actions)

5. Plugin manager UI (src/components/plugins/):
   - Plugin browser: list installed plugins
   - Enable/disable per plugin
   - Install from file (.qplugin zip)
   - Plugin settings (if plugin declares configurable options)

6. Sample plugins:
   - Pixel Sorter filter: sorts pixels by luminance (demonstrates filter API)
   - Color Info panel: shows detailed color information for pixel under cursor

VERIFY:
- Install sample filter plugin from .qplugin file
- Run Pixel Sorter on a layer — pixels visibly sorted
- Color Info panel shows live color data
- Plugin cannot access APIs without declared permissions
- Disable plugin — it no longer appears in menus
```

---

### Sprint 15 — Timelapse, Text Tool & QuickMenu (Weeks 29–30)

**Goal:** Timelapse recording, text layers, and customizable radial quick menu.

**LLM Prompt:**

```
You are building QUAR Artist Sprint 15: timelapse recording, text tool, and QuickMenu.

CONTEXT:
- Phase 2
- PRD section 4.8 (timelapse via MediaRecorder), 4.2 (QuickMenu), and general text tool needs

TASKS:
1. Timelapse recording (src/engine/timelapse/TimelapseRecorder.ts):
   - Use MediaRecorder API with canvas.captureStream(0) — frame rate = 0 means manual frame capture
   - After each stroke completes: capture current canvas state as one frame
   - This produces a smooth non-realtime replay (no jitter during active drawing)
   - Controls: start recording, stop recording, discard
   - Export as WebM video
   - Settings: output resolution (1080p / 2K / 4K)

2. Text tool (src/engine/tools/TextTool.ts):
   - Click on canvas → show text input overlay at click position
   - Text rendered to a dedicated text layer
   - Properties: font family, size, weight, color, alignment
   - Font Access API (where supported) for system fonts
   - Fallback: web-safe fonts + Google Fonts subset
   - Text is rasterized to the layer on confirm (not kept as live text in MVP)

3. Text tool UI:
   - Text options bar: font picker dropdown, size input, bold/italic toggles, alignment
   - Color uses current primary color

4. QuickMenu (src/components/ui/QuickMenu.tsx):
   - 8-slot radial menu centered on cursor position
   - Triggered by configurable shortcut (default: long-press or custom key)
   - Each slot assignable to any tool or action
   - Slots arranged in a circle, user drags toward desired slot to activate
   - Smooth radial animation (Framer Motion)
   - Default slots: Brush, Eraser, Undo, Redo, Eyedropper, Fill, Selection, Clear Layer

5. QuickMenu customization:
   - Settings dialog to assign actions to each of 8 slots
   - Persist configuration to Dexie settings

6. Timelapse UI:
   - Record button in top bar (red dot indicator when recording)
   - Stop button + export dialog (resolution, format)
   - Confirmation before discarding active recording

VERIFY:
- Start timelapse recording, paint 10 strokes, stop, export WebM
- WebM plays back showing each stroke appearing sequentially
- Text tool: click on canvas, type text, confirm — text rendered to layer
- Change font/size/color of text before confirming
- QuickMenu: trigger with shortcut, drag to select tool, tool activates
- Customize QuickMenu slots in settings, changes persist
```

---

## Agent ↔ Sprint Mapping

| Sprint | Primary Agent(s) | Supporting Agent(s) |
|--------|-------------------|---------------------|
| 1 — Scaffolding | Project Architect | Frontend Designer |
| 2 — Brush Engine | Rendering Engine | State Management |
| 3 — Layer System | Rendering Engine | Frontend Designer, State Management |
| 4 — Brushes & Color | Rendering Engine, Frontend Designer | State Management |
| 5 — Selection & Transform | Rendering Engine | Frontend Designer |
| 6 — Export & Persistence | File I/O | State Management, Frontend Designer |
| 7 — Filters | Rendering Engine | Frontend Designer, WASM Engineer |
| 8 — Shortcuts & UI Polish | Frontend Designer | State Management |
| 9 — Performance & Testing | Browser Testing, WASM Engineer | Rendering Engine, Project Architect |
| 10 — Blend Modes & Brush Studio | Rendering Engine | Frontend Designer |
| 11 — Guides & QuickShape | Rendering Engine | Frontend Designer |
| 12 — Animation | Rendering Engine | Frontend Designer, File I/O |
| 13 — Collaboration | Collaboration | State Management, Frontend Designer |
| 14 — Plugin API | Project Architect | Rendering Engine, Frontend Designer |
| 15 — Timelapse, Text, QuickMenu | Rendering Engine, Frontend Designer | File I/O |
