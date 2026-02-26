# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QUAR Artist is a professional-grade, open-source (MIT) digital illustration and painting web application. Part of the QUAR Suite (alongside QUAR Editor for 3D and QUAR Vector for 2D vector). The goal is Procreate-quality brush fidelity on the web.

**MVP is fully client-side — no backend.** All persistence is local (IndexedDB via Dexie.js, OPFS for tile data). Export via .qart file download, PNG, JPEG, PSD. Collaboration and cloud features are deferred to Phase 2+.

The full product specification is in `Quar_Artist_PRD_v1.0 (1).md`.
The design system specification is in `quar-suite-design-prompt.md`.

## Design Language — Neo-Industrial Studio

All QUAR Suite apps share one visual DNA. Quar Artist uses **amber `#F59E0B`** as its primary accent (warmth & creation). The secondary accent **bordeaux `#9F1239`** is constant across the suite.

Key visual traits:
- **Dark-mode default** — warm charcoal blacks (`#0a0a0b` primary bg), not cold grays
- **Glass panel surfaces** — `backdrop-filter: blur(12px) saturate(150%)` with `rgba(17,17,19,0.85)`
- **Noise texture overlay** — fractal noise at 1.5% opacity over the entire viewport
- **Typography** — DM Sans (UI), IBM Plex Mono (numeric readouts)
- **Icons** — Lucide React, stroke 1.5px at 22x22 in toolbars
- **Animation** — 120ms fast, 200ms normal, spring easing `cubic-bezier(0.34, 1.56, 0.64, 1)`
- **Auto-hide panels** — fade to 10% opacity after 3s inactivity, reappear on hover/touch
- **Full-bleed canvas** — painting area extends to window edges, no panel gutters

All CSS custom properties (tokens for spacing, typography, radius, shadows, z-index, animation) are defined in `quar-suite-design-prompt.md` Section 2. Amber accent overrides in Section 3.

## Technology Stack

- **UI:** React 18+ with TypeScript
- **Rendering:** PixiJS v8 (WebGPU primary, WebGL 2.0 fallback)
- **State:** Zustand (UI state only; pixel data stays in imperative engine)
- **Stroke Generation:** perfect-freehand
- **Build:** Vite 5+
- **Testing:** Vitest (unit) + Playwright (E2E + visual regression)
- **Persistence:** Dexie.js (IndexedDB for metadata), OPFS (binary file storage)
- **PSD I/O:** ag-psd
- **Collaboration (Phase 2):** Yjs CRDTs + y-websocket (not in MVP)
- **Color Science:** chroma.js
- **WASM:** Rust via wasm-bindgen for hot-path pixel ops, LZ4, filters
- **Video Export:** FFmpeg.wasm, gifenc

## Architecture

### Two-Canvas Pattern (from Excalidraw)
- **Static Canvas** (PixiJS RenderTextures): holds composited painting layers
- **Interactive Canvas**: overlays active brush preview, selection outlines, transform handles, guides, cursor

The drawing engine is imperative and operates outside React's reconciliation cycle. React only manages surrounding UI (gallery, brush studio, layers panel, toolbars). State sync between engine and React happens only on high-level events (tool change, layer select, brush param update), never per-frame.

### Brush Engine (Stamp-Based)
Pipeline: Input Capture (PointerEvent + getCoalescedEvents) -> Stroke Smoothing (exponential/rope algorithm) -> Path Interpolation (Catmull-Rom spline) -> Stamp Rendering (textured quads to active layer FBO) -> Compositing (blend mode shaders) -> Display

### Layer System
- Tile-based sparse layers: 256x256 tiles, only allocated for painted content (60-80% memory reduction)
- Virtual layer paging: active + adjacent layers in GPU memory, others paged to CPU/OPFS
- 26 blending modes via custom WGSL/GLSL fragment shaders

### Undo/Redo
Hybrid tile-based diffing: tracks dirty 256x256 tiles per operation, stores only changed tiles. Command pattern records metadata alongside tile diffs. Target: 100+ undo states.

### File Format (.qart)
ZIP archive: JSON metadata + 256x256 LZ4-compressed tile chunks + optional WebM timelapse.

### Input System
W3C Pointer Events Level 3. Uses `getCoalescedEvents()` for 120Hz+ points, `getPredictedEvents()` to reduce perceived latency. `desynchronized: true` canvas hint to bypass DOM compositor. Touch rejection when pen detected.

## Key Constraints

- iOS Safari: 256MB canvas memory limit (mitigated by tile-based sparse layers)
- Web input latency floor: 16-33ms vs Procreate's native 9ms (mitigated by predicted events + desynchronized canvas)
- Safari `getCoalescedEvents()` gaps (fallback to rAF interpolation)
- No Apple Pencil Pro barrel roll/squeeze/double-tap on web
- WASM 4GB memory ceiling
- Safari 7-day storage eviction (request persistent storage; export .qart as manual backup)

## AI Agent Definitions

Agent instruction files live in `agents/`. Each defines a specialized role, tools, and responsibilities:

| Agent | File | Scope |
|-------|------|-------|
| Frontend Designer | `agents/frontend-designer.md` | React UI, panels, responsive layout (/frontend-design skill) |
| Browser Testing | `agents/browser-testing.md` | E2E tests, cross-browser validation (Playwright MCP) |
| Rendering Engine | `agents/rendering-engine.md` | PixiJS, WebGPU/WebGL, brush engine, shaders, compositing |
| Project Architect | `agents/project-architect.md` | Scaffolding, Vite config, module boundaries, CI |
| State Management | `agents/state-management.md` | Zustand stores, engine↔React bridge, Dexie.js, OPFS |
| WASM Engineer | `agents/wasm-engineer.md` | Rust→WASM hot paths: LZ4, filters, pixel ops |
| Collaboration | `agents/collaboration.md` | Yjs CRDTs, WebSocket, cursor presence, layer locking |
| File I/O | `agents/file-io.md` | .qart format, PSD/PNG/JPEG export, persistence |

## Sprint Plan

Full sprint plan with detailed LLM prompts: `sprints/sprint-plan.md`

15 sprints across two phases:
- **Phase 1 MVP (Sprints 1–9, Weeks 1–18):** Scaffold → Brush engine → Layers → Color → Selection → Persistence → Filters → UI polish → Performance/testing. **Fully client-side, no backend.** Local save (IndexedDB + OPFS) + .qart/PNG/JPEG/PSD export.
- **Phase 2 v1.0 (Sprints 10–15, Weeks 19–30):** Full blend modes → Guides → Animation → Collaboration (Yjs + WebSocket server) → Plugin API → Timelapse/text → Cloud save
- **Phase 3 v2.0:** Scoped later — wet media, 3D painting, keyframe animation, .procreate import, CMYK/ICC
