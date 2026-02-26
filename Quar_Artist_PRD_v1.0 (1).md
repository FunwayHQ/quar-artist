# QUAR ARTIST — Product Requirements Document

**Professional Digital Illustration for the Open Web**

Part of the QUAR Suite | Open Source (MIT License)

Version 1.0 | February 2026 | Status: Draft

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Strategy](#2-product-vision--strategy)
3. [Competitive Landscape Analysis](#3-competitive-landscape-analysis)
4. [Procreate Feature Audit & Mapping](#4-procreate-feature-audit--mapping)
   - 4.1 Brush Engine
   - 4.2 Canvas, Navigation & Gestures
   - 4.3 Layer System
   - 4.4 Selection & Transform
   - 4.5 Color Tools
   - 4.6 Drawing Assists & Shape Tools
   - 4.7 Adjustments & Filters
   - 4.8 Animation
   - 4.9 Export & File Management
   - 4.10 Apple Pencil Integration
   - 4.11 Graphics Tablet Support (Wacom, Huion, XP-Pen)
5. [Technical Architecture](#5-technical-architecture)
   - 5.1 Architectural Overview
   - 5.2 Core Engine
   - 5.3 Input System
   - 5.4 State Management
   - 5.5 File I/O & Persistence
   - 5.6 Collaboration
   - 5.7 Performance Optimization
6. [Technology Stack](#6-technology-stack)
7. [Development Roadmap](#7-development-roadmap)
8. [Known Web Platform Limitations & Mitigations](#8-known-web-platform-limitations--mitigations)
9. [Risk Assessment](#9-risk-assessment)
10. [Success Metrics & KPIs](#10-success-metrics--kpis)
11. [Appendices](#11-appendices)

---

## 1. Executive Summary

Quar Artist is a professional-grade, open-source digital illustration and painting application built for the web using React and WebGPU. Positioned as a core product within the QUAR Suite ecosystem alongside QUAR Editor (3D collaborative design) and QUAR Vector (2D vector graphics), Quar Artist targets the gap between Procreate's iPad-exclusive, native-performance painting experience and the accessibility of web-based creative tools.

The digital illustration market is dominated by Procreate on iPad, with no web-based competitor offering equivalent brush fidelity, layer management, or creative workflow. Existing web painting tools like Photopea focus on photo editing, Kleki offers only basic brushes, and Magma prioritizes collaboration over painting quality. Quar Artist aims to be the first tool that combines Procreate-quality brush simulation with the transformative advantages of the web platform: real-time collaboration, zero-install cross-platform access, a JavaScript plugin ecosystem, and cloud-native project storage.

**Target outcome:** A web application capable of replicating 70–80% of Procreate's core painting experience on desktop browsers and 50–60% on iPad Safari at MVP, with the gap narrowing as WebGPU matures through 2026–2027.

### 1.1 Document Scope

This PRD serves as the comprehensive technical and product specification for Quar Artist, covering product vision, competitive positioning, complete feature specifications derived from a full Procreate feature audit, technical architecture decisions, development roadmap, and success metrics. It integrates findings from deep research into Procreate's 190+ brush system, 26 blending modes, animation pipeline, and Apple Pencil integration, alongside a technical feasibility analysis of WebGL 2.0, WebGPU, Pointer Events API, and the modern web platform.

### 1.2 Key Strategic Differentiators

| Differentiator | Procreate (Competitor) | Quar Artist (Ours) |
|---|---|---|
| Platform | iPad only (iPadOS native) | Any device with a modern browser |
| Collaboration | None (file-based sharing only) | Real-time multi-user via CRDT (Yjs) |
| Extensibility | No plugin system | JavaScript/WASM plugin API |
| Cost Model | $12.99 one-time purchase | Free, open-source (MIT license) |
| Cloud Storage | Limited iCloud sync | Native cloud save, version history, shareable links |
| Rendering Engine | Valkyrie (Metal API, proprietary) | WebGPU + WebGL 2.0 fallback |

---

## 2. Product Vision & Strategy

### 2.1 Vision Statement

*Quar Artist will be the premier professional illustration tool of the web-first era* — delivering Procreate-quality brush fidelity with the collaborative power of Figma, accessible from any device without installation, and extensible through an open plugin ecosystem.

### 2.2 Target Users

- **Professional Digital Illustrators** — Artists currently locked into iPad/Procreate who need cross-platform access or collaboration features
- **Hobbyist Artists & Students** — Users who cannot afford or access iPad hardware but want professional painting tools
- **Concept Artists & Game Developers** — Teams needing real-time collaborative painting with layer sharing
- **Educators & Workshop Leaders** — Zero-install classroom access for digital art instruction
- **Plugin Developers** — Engineers building custom brushes, filters, and workflow automations

### 2.3 Product Principles

1. **Performance First:** Every architectural decision prioritizes rendering speed and input responsiveness. The drawing engine operates outside React's reconciliation cycle.
2. **Artist-Centric UX:** The interface should disappear during painting. Canvas real estate is maximized; toolbars are contextual and collapsible.
3. **Progressive Complexity:** New users see a clean, approachable interface. Advanced features (brush studio, animation, 3D painting) are discoverable, not overwhelming.
4. **Open Ecosystem:** Every component — brush format, plugin API, file format — is documented and extensible by the community.
5. **Web-Native Advantages:** Collaboration, cloud sync, and instant sharing are first-class features, not afterthoughts.

---

## 3. Competitive Landscape Analysis

### 3.1 Market Overview

The digital painting tool market segments into native desktop applications (Photoshop, Krita, Clip Studio Paint), native iPad applications (Procreate, Fresco), and web-based tools (Photopea, Kleki, Magma). No web-based tool currently offers professional-grade natural media brush simulation. This represents the primary market opportunity for Quar Artist.

### 3.2 Competitor Feature Matrix

| Feature | Procreate | Photopea | Kleki | Magma | Krita | Quar Artist |
|---|---|---|---|---|---|---|
| Platform | iPad | Web | Web | Web | Desktop | Web |
| Brush Quality | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★★★★ | ★★★★☆ (target) |
| Layer System | Full (26 modes) | Full (PSD) | Basic (8 layers) | Basic | Full (plugin) | Full (26 modes) |
| Collaboration | None | None | None | Real-time | None | Real-time |
| Animation | Frame + Dreams | Basic | None | None | Full | Frame-by-frame |
| 3D Painting | USDZ/OBJ | None | None | None | None | USDZ/OBJ (v2) |
| Plugin System | None | None | None | None | Python | JS/WASM API |
| Open Source | No | No | Yes (MIT) | No | Yes (GPL) | Yes (MIT) |
| PSD Support | Export | Full R/W | Import | Export | Full R/W | Full R/W |
| Price | $12.99 | Free/Ads | Free | Freemium | Free | Free |

### 3.3 Key Competitor Insights

**Procreate** — Dominance rests on three pillars: the Valkyrie engine's Metal GPU integration delivering sub-9ms input latency; the Brush Studio's 14 parameter categories enabling photorealistic natural media simulation; and deep Apple Pencil integration (pressure, tilt, azimuth, barrel roll, squeeze, haptics). Weaknesses: iPad exclusivity, zero collaboration, no plugin ecosystem, limited cloud sync.

**Photopea** — Built single-handedly by Ivan Kutskir, proves a single developer can create a Photoshop-class web editor. Supports 60+ file formats, generates over $1M/year through ads. Primarily a photo editor, not a painting tool — brush engine lacks natural media simulation. Not open-source.

**Kleki/Klecks** — The most relevant open-source architectural reference. Built in TypeScript with Canvas 2D for painting and WebGL for filters. 4-brush set is deliberately minimal, but the MIT-licensed codebase demonstrates viable patterns for web painting apps.

**Figma (Architecture Reference)** — C++ compiled to WebAssembly, WebGL rendering, TypeScript/React UI, Yjs-based CRDT collaboration. The gold standard architecture for web creative tools. 10,000+ plugin ecosystem validates the extensibility opportunity. WASM+WebGL+React pattern achieved 3× load time improvement over pure JavaScript and is directly applicable to Quar Artist.

**Krita** — The most sophisticated open-source brush engine with 14 separate brush engine plugins (Pixel, Color Smudge, Bristle, Shape, Sketch, Particle, MyPaint, Spray, Deform, Filter, Hatching, Tangent Normal, Quick, Chalk). Architecture separates factory, paint information, preset, and paint operation classes. Tile-based image storage and command-pattern undo are directly relevant patterns. No web port exists due to massive C++/Qt codebase.

---

## 4. Procreate Feature Audit & Mapping

This section provides a comprehensive catalog of Procreate's feature set, organized by functional area, with implementation priority and technical approach for Quar Artist.

### 4.1 Brush Engine (190+ Brushes, 14 Parameter Categories)

Procreate ships 190+ brushes across 18 default sets (Pencils, Pens, Inks, Markers, Pastels, Oils, Paints, Gouache, Watercolors, Charcoals, Basics, Lettering, Comics, Design, Grunge, Street Art, Digital, Creative) plus specialty libraries (Materials, Vintage, Luminance, Industrial, Organic, Elements, Spatter).

At the center of Procreate's performance is the **Valkyrie engine**, which leverages Apple's Metal API to provide 64-bit color depth and near-zero latency rendering. Metal allows direct GPU interaction, bypassing the overhead of traditional graphics APIs. For Quar Artist, **WebGPU** represents the necessary architectural leap — designed to mirror Metal and Vulkan with stateless, asynchronous pipeline execution, multi-threaded command recording, and compute shaders.

The Brush Studio exposes the following parameter categories:

| Parameter Category | Key Settings | Quar Artist Implementation | Phase |
|---|---|---|---|
| Stroke Path | Spacing, jitter, StreamLine, fall-off, taper | Vertex generation frequency in brush shader | MVP |
| Shape Source | 100+ textures, scatter, rotation, randomness | UV-mapping transformations in fragment shader | MVP |
| Grain Source | Rolling/texturized, movement, scale, depth | Secondary texture sampling in fragment shader | MVP |
| Rendering | 4 glaze modes (Light/Uniform/Intense/Heavy), per-brush blend, flow, wet edges, burnt edges | Multi-pass WebGPU render pipeline | v1.0 |
| Wet Mix | Dilution, charge, attack, pull, grade, wetness jitter, color pull | GPU compute shader paint simulation | v2.0 |
| Color Dynamics | Per-stamp/stroke HSB jitter, secondary color, pressure/tilt mapping | Shader uniform mapping from PointerEvent data | v1.0 |
| Dynamics | Speed-linked size, opacity, jitter | Velocity calculation from coalesced events | MVP |
| Apple Pencil | Pressure curves, tilt mapping, azimuth, barrel roll (Pro) | PointerEvent.pressure/tiltX/tiltY/azimuthAngle | MVP |
| Stabilization | StreamLine, stabilization, motion filtering | Exponential smoothing + rope/lazy mouse algorithm | MVP |
| Taper | Separate pressure/touch taper with per-end size/opacity curves | Parametric curve evaluation at stroke endpoints | v1.0 |
| Properties | Stamp preview, orient to screen, size/opacity limits, smudge | Configurable brush property system | v1.0 |
| Dual Brush | Combines two brushes' shape and grain into composite stroke | Two-texture fragment shader composition | v1.0 |

#### 4.1.1 Stroke Smoothing Algorithms

Procreate offers three distinct smoothing mechanisms critical for professional use:

**StreamLine** uses exponential smoothing:

```
S_t = α × P_t + (1 − α) × S_{t−1}
```

Where `S_t` is the smoothed point, `P_t` is the current input point, and `α` is the smoothing factor.

**Stabilization** uses a moving average of recent points.

**Motion Filtering** uses a more sophisticated algorithm that removes wobble extremities without the "squashing" effect of standard averaging.

For Quar Artist, a **"Rope" / "Lazy Mouse" algorithm** is recommended: a virtual anchor only moves when the physical stylus exceeds a configurable rope length `R` from it. B-spline or Catmull-Rom spline interpolation provides final path smoothing.

#### 4.1.2 Brush Rendering Pipeline

A digital stroke in this model is not a continuous line but a series of **"stamps"** where a brush shape (acting as a container) holds a grain (a texture). The stamp-based approach uses WebGPU textured quads along Catmull-Rom spline-interpolated paths. Each stamp's size, opacity, rotation, and scatter respond to pressure/tilt/speed via the brush parameter system.

#### 4.1.3 Brush Import/Export

Procreate supports `.brush`, `.brushset`, `.brushlibrary`, and Photoshop `.abr` import. A massive third-party ecosystem exists on Gumroad, Creative Market, and Etsy. Quar Artist will define a `.qbrush` JSON-based format, with `.abr` import support via WASM parser and potential `.brush` import through format reverse-engineering.

### 4.2 Canvas, Navigation & Gesture System

Maximum canvas sizes scale with iPad RAM: 134 megapixels (16,384 × 8,192) on M-series iPads. DPI is freely configurable (72–300+).

| Feature | Procreate Specification | Quar Artist Implementation | Phase |
|---|---|---|---|
| Max Canvas | 16,384×8,192 (134MP on M-series) | 8,192×8,192 desktop; 4,096×4,096 mobile | MVP |
| DPI Settings | Freely configurable (72–300+) | 72/150/300 presets + custom | MVP |
| Zoom/Rotate | Two-finger pinch/twist | Pointer Events + wheel + gesture recognition | MVP |
| Undo/Redo | Two/three-finger tap (250 levels) | Ctrl+Z / keyboard + gesture (100+ levels) | MVP |
| Copy/Paste | Three-finger swipe down menu | Ctrl+C/V + context menu | MVP |
| Eyedropper | Touch-and-hold | Alt+click + EyeDropper API | MVP |
| QuickMenu | 6 customizable radial buttons | Customizable radial menu (8 slots) | v1.0 |
| Reference Window | Floating canvas/image/face/3D reference | Floating reference panel | v1.0 |
| Fullscreen | Four-finger tap | F11 / button toggle | MVP |
| Hover Preview | Brush preview before touching (M-series) | PointerEvent hover (buttons=0) on tablets | v1.0 |

### 4.3 Layer System

Layer types include standard, background color, clipping mask, layer mask, alpha lock, reference, drawing assist, group, and text layers. Layer limits are dynamically calculated from device RAM and canvas dimensions (e.g., ~115 layers at 4096×4096 on M4 iPad Pro).

#### 4.3.1 Blending Modes (26 Total)

| Category | Modes | Implementation |
|---|---|---|
| Normal | Normal, Pass Through (groups) | Canvas 2D globalCompositeOperation |
| Darken (5) | Multiply, Darken, Color Burn, Linear Burn, Darker Color | Custom GLSL/WGSL fragment shaders |
| Lighten (5) | Lighten, Screen, Color Dodge, Add, Lighter Color | Custom GLSL/WGSL fragment shaders |
| Contrast (7) | Overlay, Soft Light, Hard Light, Vivid Light, Linear Light, Pin Light, Hard Mix | Custom GLSL/WGSL fragment shaders |
| Difference (4) | Difference, Exclusion, Subtract, Divide | Custom GLSL/WGSL fragment shaders |
| Color (4) | Hue, Saturation, Color, Luminosity | HSL conversion in shader |

All 16 standard modes are available via Canvas 2D `globalCompositeOperation`. Complex modes (Vivid Light, Linear Light, Pin Light, Hard Mix, Divide, Darker/Lighter Color) require custom WebGL/WebGPU fragment shaders with a two-pass read-destination-compute-write approach.

#### 4.3.2 Layer Memory Architecture

A 4096×4096 RGBA texture consumes **64MB** of GPU memory. iOS Safari's 256MB canvas memory limit caps practical layer count to ~4 full-resolution layers. Quar Artist mitigates this through:

- **Tile-based sparse layers:** Divide each layer into 256×256 tiles, only allocating GPU memory for tiles containing painted content. Empty tiles reference a shared transparent texture. Reduces memory footprint by 60–80%.
- **Virtual layer paging:** Active + adjacent layers in GPU memory; others paged to CPU RAM or OPFS.
- **Automatic layer flattening:** Non-active visible layer groups composited into cached FBOs.

### 4.4 Selection & Transform Tools

| Feature | Procreate Specification | Quar Artist Implementation | Phase |
|---|---|---|---|
| Automatic Select | Threshold-based flood fill selection | WebGL flood fill with configurable tolerance | MVP |
| Freehand Select | Freehand + polygonal modes | PointerEvent path with vertex editing | MVP |
| Rectangle/Ellipse | Geometric selection shapes | Standard shape selection tools | MVP |
| Feathering | Adjustable edge softness | Gaussian blur on selection mask | MVP |
| Transform: Freeform | Free scaling/rotation | Matrix2D transformation | MVP |
| Transform: Distort | Four-corner distortion | Perspective transform matrix | v1.0 |
| Transform: Warp | Mesh-based warping (advanced mesh) | Bezier mesh deformation shader | v1.0 |
| Transform: Perspective | Vanishing point adjustment | Homography matrix transform | v1.0 |
| Snapping/Magnetics | Auto-alignment guides | Edge/center snapping algorithm | v1.0 |
| Interpolation | Nearest neighbor / Bilinear / Bicubic | Fragment shader interpolation modes | MVP |

### 4.5 Color Tools

| Feature | Procreate Specification | Quar Artist Implementation | Phase |
|---|---|---|---|
| Color Disc | HSB wheel with zoomable saturation/brightness | Canvas 2D/SVG disc with smooth interaction | MVP |
| Classic Picker | Square SV picker + hue bar | Standard HSV picker component | MVP |
| Harmony Modes | Complementary, analogous, triadic, split-comp, tetradic | HSL math (see below) | MVP |
| Value Sliders | HSB/RGB/Hex input | Controlled inputs with live preview | MVP |
| Palettes | Custom, imported, Pantone | JSON palette format + import/export | MVP |
| ColorDrop | Flood fill with drag-to-adjust threshold | WebGL flood fill with slider | MVP |
| Gradient Map | 8 presets + custom gradients | LUT shader with gradient texture | v1.0 |
| Color Profiles | Display P3, sRGB, CMYK (FOGRA, SWOP) | CSS color(display-p3), ICC via WASM LCMS | v1.0 |

#### Color Harmony Algorithms

The color system operates in HSL space for human-understandable mathematical transformations:

| Harmony Mode | Formula (Hue H) | Result |
|---|---|---|
| Complementary | `H_comp = (H_base + 180) mod 360` | Direct opposite on wheel |
| Analogous | `H = (H_base ± 30) mod 360` | Neighbors; uniform mood |
| Triadic | `H = (H_base ± 120) mod 360` | Equilateral triangle; vibrant |
| Split-Complementary | `H = (H_base + 150), (H_base + 210) mod 360` | Base + two neighbors of complement |
| Tetradic | `H = (H_base + 90, 180, 270) mod 360` | Four balanced points; highest variety |

Wide-gamut Display P3 support via `canvas.getContext('2d', { colorSpace: 'display-p3' })` in Safari and Chrome 94+. For CMYK and ICC profile management, `chroma.js` for color space conversion and CSS Color Module Level 4 for wide-gamut representation.

### 4.6 Drawing Assists & Shape Tools

| Feature | Description | Phase |
|---|---|---|
| QuickShape | Snaps drawn shapes to perfect geometry with edit nodes | v1.0 |
| 2D Grid | Configurable grid overlay with snap-to-grid drawing | v1.0 |
| Isometric Grid | 30°/60° isometric guide with assisted drawing | v1.0 |
| Perspective (1/2/3pt) | Vanishing point-based perspective guides with stroke snapping | v1.0 |
| Symmetry | Vertical, horizontal, quadrant, radial (with rotation toggle) | v1.0 |
| StreamLine | Real-time stroke smoothing with adjustable intensity | MVP |
| Motion Filtering | Advanced wobble removal without squashing | v1.0 |

### 4.7 Adjustments & Filters

| Adjustment | Procreate Modes/Options | Implementation Approach | Phase |
|---|---|---|---|
| Gaussian Blur | Adjustable radius, layer/pencil mode | GPU fragment shader (separable 2-pass) | MVP |
| Motion Blur | Adjustable angle and distance | Directional kernel shader | v1.0 |
| Perspective Blur | Tilt-shift style focal plane | Depth-based blur shader | v1.0 |
| Sharpen | Adjustable amount | Unsharp mask shader | MVP |
| Noise | Clouds/billows/ridges + scale/octaves/turbulence | Perlin/simplex noise shader | v1.0 |
| Hue/Sat/Brightness | Per-channel adjustment | HSL conversion shader | MVP |
| Color Balance | Shadows/midtones/highlights | 3-way color grading shader | v1.0 |
| Curves | RGB + per-channel | LUT-based shader from spline control points | MVP |
| Gradient Map | 8 presets + custom | Luminance-to-gradient LUT shader | v1.0 |
| Liquify | 8 modes: push, twirl L/R, pinch, expand, crystals, edge, reconstruct | GPU mesh deformation with velocity field | v1.0 |
| Clone Tool | Source point sampling | Offset texture sampling brush | v1.0 |
| Chromatic Aberration | Perspective + displacement modes | RGB channel offset shader | v1.0 |
| Halftone | 3 modes | Dot-pattern fragment shader | v1.0 |
| Bloom | Glow with adjustable threshold | Multi-pass Gaussian + blend shader | v1.0 |
| Glitch | 4 modes: artifact/wave/signal/diverge | Channel shift + scanline shaders | v1.0 |
| Recolor | Color replacement tool | Hue-locked replacement shader | v1.0 |

All filters support both **layer mode** (applied to entire layer) and **pencil mode** (painted on interactively), mirroring Procreate's dual application model. In WebGPU, pencil-mode filters are applied as real-time fragment shader effects on the active brush stamp.

### 4.8 Animation

Procreate offers two animation systems: Animation Assist (built-in frame-by-frame) and Procreate Dreams (standalone advanced animation app with keyframes, multi-track timeline, perform mode, and audio).

| Feature | Procreate Implementation | Quar Artist Implementation | Phase |
|---|---|---|---|
| Frame-by-Frame | Each layer = one frame | Layer-based frames with timeline UI | v1.0 |
| Onion Skinning | Prev/next frames at decreasing opacity | Multi-texture shader blend (60/40/20%) | v1.0 |
| FPS Control | 1–60 FPS adjustable | FPS slider with real-time preview | v1.0 |
| Playback Modes | Loop, ping-pong, one-shot | Configurable playback modes | v1.0 |
| Export: GIF | Animated GIF export | gifenc library (client-side) | v1.0 |
| Export: MP4/HEVC | Video export | FFmpeg.wasm client-side encoding | v1.0 |
| Export: PNG Sequence | Per-frame PNG files | Canvas toBlob() per frame + ZIP download | v1.0 |
| Keyframe Animation | Dreams: property keyframes with easing | Keyframe timeline with easing curves | v2.0 |
| Scene Management | Dreams: multi-scene projects | Scene panel with drag reordering | v2.0 |
| Audio Support | Dreams: audio track sync | Web Audio API timeline sync | v2.0 |

**Onion skinning implementation:** In a WebGPU context, bind multiple texture buffers (N preceding and succeeding frames) to the fragment shader and blend in a single pass with decreasing opacity uniforms.

**Timelapse recording:** Use the `MediaRecorder` API with a "non-realtime" capture approach — a frame is only added to the video stream after a stroke is completed, ensuring jitter-free replay without taxing the CPU during active drawing.

### 4.9 Export & File Management

| Feature | Procreate Support | Quar Artist Implementation | Phase |
|---|---|---|---|
| .procreate (native) | Full project with all metadata | .qart (ZIP: JSON metadata + LZ4 tile chunks) | MVP |
| PSD Export/Import | Export with layers | Full R/W via ag-psd library (MIT) | MVP |
| PNG/JPEG/TIFF | Standard image export | Canvas toBlob() / toDataURL() | MVP |
| PDF | Single/multi-page export | jsPDF or pdf-lib | v1.0 |
| SVG | Not supported | Vector export from shape/text layers | v1.0 |
| Timelapse | Auto-record, 1080p–4K, 30s/full export | MediaRecorder API + captureStream(30) | v1.0 |
| Gallery Management | Grid view, stacks, preview thumbnails | React gallery with project cards | MVP |

#### 4.9.1 The .procreate File Format

The `.procreate` format is a ZIP archive containing:

- **Document.archive** — Binary property list (plist) manifest with layer metadata, blend modes, canvas properties
- **Layer Data Chunks** — Pixel data divided into 256×256 RGBA blocks, compressed using LZO algorithm (optimized for decompression speed)
- **Embedded MP4** — Optional timelapse video recording

Quar Artist's native `.qart` format mirrors this architecture:

| Component | Procreate | Quar Artist |
|---|---|---|
| Container | ZIP Archive | ZIP (JSZip or native CompressionStream API) |
| Metadata | Binary Plist | JSON (human-readable, versionable) |
| Pixel Data | 256×256 LZO Chunks | 256×256 LZ4 Chunks (comparable speed, better JS ecosystem) |
| Video Data | Embedded MP4 Timelapse | WebM via MediaRecorder API |

### 4.10 Apple Pencil Integration

| Pencil Feature | Procreate Usage | Web API Equivalent | Feasibility |
|---|---|---|---|
| Pressure (all models) | Mapped to size/opacity/bleed/smoothing via custom curves | `PointerEvent.pressure` (0.0–1.0) | ✅ Full support |
| Tilt (all models) | Mapped to size/opacity/gradation/bleed/size compression | `PointerEvent.tiltX/tiltY`, `altitudeAngle` | ✅ Full support |
| Azimuth | Brush rotation relative to tilt direction | `PointerEvent.azimuthAngle` or `twist` | ✅ Full support |
| Double-Tap (2nd gen+) | Customizable tool switching | No web equivalent | ❌ NOT possible |
| Hover Preview (M-series) | Brush preview before touch | `PointerEvent` with `buttons=0` on iPadOS | ⚠️ Partial support |
| Barrel Roll (Pro) | Gyroscope-based brush rotation | No web equivalent | ❌ NOT possible |
| Squeeze (Pro) | Configurable action trigger | No web equivalent | ❌ NOT possible |
| Haptic Feedback (Pro) | Tactile response for actions | No web equivalent (Vibration API N/A in Safari) | ❌ NOT possible |

Pressure, tilt, and azimuth data from all Apple Pencil models are fully accessible through Safari's Pointer Events implementation. `getCoalescedEvents()` provides 120Hz+ intermediate points for smooth strokes (Chrome/Firefox; Safari in progress). `getPredictedEvents()` enables drawing-ahead to reduce perceived latency by 8–16ms. The four Apple Pencil Pro exclusive features (barrel roll, squeeze, double-tap, haptics) require native UIKit APIs and have no web equivalent.

### 4.11 Graphics Tablet Support (Wacom, Huion, XP-Pen, and Others)

Quar Artist supports all major graphics tablets natively through the W3C Pointer Events API. The browser's tablet driver translates hardware-specific protocols into standard `PointerEvent` objects with `pointerType: "pen"`, meaning no tablet-specific code is required in the application layer. All tablets that work with the operating system's standard driver infrastructure are automatically compatible.

#### 4.11.1 Supported Input Channels

The Pointer Events API exposes identical data channels regardless of tablet manufacturer:

| Input Channel | Web API Property | Wacom Support | Huion Support | XP-Pen Support | Surface Pen | Samsung S Pen |
|---|---|---|---|---|---|---|
| Pressure | `PointerEvent.pressure` (0.0–1.0) | ✅ 8192 levels | ✅ 8192 levels | ✅ 8192/16384 levels | ✅ 4096 levels | ✅ 4096 levels |
| Tilt X/Y | `PointerEvent.tiltX/tiltY` (±90°) | ✅ ±60° typical | ✅ ±60° typical | ✅ ±60° typical | ✅ ±60° typical | ✅ Limited range |
| Hover Detection | `pointermove` with `buttons=0` | ✅ ~10mm height | ✅ ~10mm height | ✅ ~10mm height | ✅ | ✅ |
| Barrel Rotation | `PointerEvent.twist` (0–359°) | ✅ Art Pen / Pro Pen 3 only | ❌ | ❌ | ❌ | ❌ |
| Pen Button (primary) | `PointerEvent.button === 2` or `5` | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pen Button (secondary) | `PointerEvent.button === 5` or `buttons` bitmask | ✅ | ✅ | ✅ | ❌ (single button) | ❌ |
| Eraser Tip | `PointerEvent.button === 5` (eraser end) | ✅ | ✅ (select models) | ✅ (select models) | ✅ | ❌ |

**Note on pressure resolution:** All tablets report pressure as a 0.0–1.0 float via the Pointer Events API regardless of hardware resolution (8192, 4096, or 16384 levels). The browser driver handles quantization mapping. In practice, 4096+ levels are indistinguishable to artists, so all modern tablets provide equivalent pressure fidelity.

#### 4.11.2 Tablet Compatibility Matrix

| Manufacturer | Product Lines | Type | Pressure Levels | Tilt | Twist | Browser Compatibility |
|---|---|---|---|---|---|---|
| **Wacom** | Intuos (S/M) | Screenless | 4096 | ✅ | ❌ | Chrome, Firefox, Edge, Safari |
| | Intuos Pro (S/M/L) | Screenless | 8192 | ✅ | ✅ (Pro Pen 3) | Chrome, Firefox, Edge, Safari |
| | Cintiq 16/22 | Pen Display | 8192 | ✅ | ❌ | Chrome, Firefox, Edge, Safari |
| | Cintiq Pro 17/22/27 | Pen Display | 8192 | ✅ | ✅ (Pro Pen 3) | Chrome, Firefox, Edge, Safari |
| | One (S/M) | Screenless | 4096 | ✅ | ❌ | Chrome, Firefox, Edge, Safari |
| | Movink | Pen Display (OLED) | 8192 | ✅ | ✅ (Pro Pen 3) | Chrome, Firefox, Edge, Safari |
| **Huion** | Inspiroy H/HS series | Screenless | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Inspiroy 2 / Dial 2 | Screenless | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Kamvas 13/16/22/24 | Pen Display | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Kamvas Pro series | Pen Display | 16384 | ✅ | ❌ | Chrome, Firefox, Edge |
| **XP-Pen** | Deco series (S/M/L/MW) | Screenless | 8192/16384 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Artist series (12/13/16/22/24) | Pen Display | 8192/16384 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Artist Pro series | Pen Display | 16384 | ✅ | ❌ | Chrome, Firefox, Edge |
| **Microsoft** | Surface Pen | Tablet Stylus | 4096 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Surface Slim Pen 2 | Tablet Stylus | 4096 | ✅ | ❌ | Chrome, Firefox, Edge |
| **Samsung** | S Pen (Galaxy Tab S series) | Tablet Stylus | 4096 | ✅ Limited | ❌ | Chrome, Samsung Internet |
| **Apple** | Apple Pencil (1st/2nd/USB-C/Pro) | Tablet Stylus | Continuous | ✅ | ✅ (Pro only, native-only) | Safari |
| **Xencelabs** | Pen Tablet (M/L) | Screenless | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |
| | Pen Display 24 | Pen Display | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |
| **Gaomon** | M/S series | Screenless | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |
| | PD series | Pen Display | 8192 | ✅ | ❌ | Chrome, Firefox, Edge |

#### 4.11.3 Hardware Buttons & Express Keys

Tablet-specific hardware buttons (Wacom Express Keys, Huion press keys, XP-Pen shortcut buttons, dial/scroll wheels) are **not** exposed through web APIs. These are handled entirely by the tablet's driver software, which remaps physical buttons to keyboard shortcuts or system actions at the OS level.

Quar Artist supports this workflow through its comprehensive keyboard shortcut system:

| Tablet Button | Recommended Driver Mapping | Quar Artist Action |
|---|---|---|
| Button 1 (pen barrel) | Right-click | Context menu / eyedropper |
| Button 2 (pen barrel) | Middle-click or custom key | Pan canvas / toggle eraser |
| Express Key 1 | `Ctrl+Z` / `Cmd+Z` | Undo |
| Express Key 2 | `Ctrl+Shift+Z` / `Cmd+Shift+Z` | Redo |
| Express Key 3 | `B` | Brush tool |
| Express Key 4 | `E` | Eraser tool |
| Express Key 5 | `Space` (hold) | Pan canvas |
| Express Key 6 | `Alt` (hold) | Eyedropper |
| Scroll Wheel / Touch Ring | `Ctrl+Scroll` or `[` / `]` | Brush size adjustment |
| Dial / Touch Strip | Custom key combo | Zoom or brush opacity |

**Eraser tip detection:** When a user flips to the eraser end on supported tablets (Wacom, select Huion/XP-Pen models), the browser reports a different `pointerId` or button state. Quar Artist will detect this and automatically switch to the eraser tool, matching Procreate's behavior.

#### 4.11.4 Driver-Specific Considerations

**Wacom:** The most mature driver ecosystem. The Wacom Desktop Center / Wacom Tablet Properties app provides per-application profiles. Users should create a "Browser" profile with their preferred Quar Artist shortcuts. Wacom's driver reliably reports all Pointer Event properties across all browsers. The **Wacom Art Pen** and **Pro Pen 3** are the only widely available styli that support barrel rotation (`PointerEvent.twist`), which Quar Artist maps to brush rotation in the shader.

**Huion:** HuionTablet driver required on macOS/Windows. On some older driver versions, tilt data may not propagate correctly in Firefox. Users should ensure they are running the latest driver. Huion's newer PenTech 4.0 and PW600/PW600S pens provide excellent pressure curves comparable to Wacom.

**XP-Pen:** Pentablet driver required. Generally reliable across Chrome and Edge. Some users report tilt data inconsistencies in Firefox on macOS with older drivers — recommend updating to latest driver version. XP-Pen's X3 Pro / X3 Pro Smart Chip pens offer hardware-level pressure detection with very low initial activation force, beneficial for light sketching.

**Microsoft Surface:** Surface Pen and Slim Pen 2 work natively in Windows browsers without additional drivers. Pressure and tilt are fully supported in Chrome, Firefox, and Edge. The Slim Pen 2's haptic feedback is OS-level only and not accessible to web applications.

**Samsung S Pen:** Works in Chrome and Samsung Internet on Galaxy Tab S series. Tilt support is more limited than dedicated tablets. Pressure sensitivity is functional but the 4096-level resolution is adequate for painting workflows.

**Linux (Wacom/Huion/XP-Pen):** Linux users typically use the `libinput` or `xf86-input-wacom` driver stack. Pointer Events work in Chrome and Firefox on Wayland and X11, though some tablet models may require community driver configurations (DIGImend project for Huion/XP-Pen). Quar Artist will document known Linux compatibility in its help center.

#### 4.11.5 Implementation Requirements

| Requirement | Implementation | Phase |
|---|---|---|
| Pressure curve calibration | User-configurable pressure curve editor (map input pressure to output response) | MVP |
| Pen vs touch vs mouse detection | Check `PointerEvent.pointerType` to adjust behavior per input device | MVP |
| Eraser tip auto-switch | Detect eraser `pointerId` / button change; switch to eraser tool | MVP |
| Barrel rotation mapping | Map `PointerEvent.twist` to brush angle uniform (Wacom Art Pen / Pro Pen 3) | v1.0 |
| Pen button customization | Settings panel for mapping pen barrel buttons to Quar Artist actions | v1.0 |
| Hover cursor preview | Show brush outline at cursor position during hover (`buttons=0`) events | MVP |
| Multi-device hot-switching | Handle simultaneous pen + touch + mouse without conflicts | MVP |
| Tablet setup guide | In-app guide with recommended driver settings per manufacturer | v1.0 |

**Pressure curve calibration** is critical for professional artists who switch between tablets. A Wacom Intuos Pro has a different native pressure feel than a Huion Kamvas. Quar Artist will provide a pressure curve editor (similar to Procreate's per-brush pressure curve) allowing artists to customize the input-to-output mapping. A "test stroke" area lets users calibrate before painting.

---

## 5. Technical Architecture

### 5.1 Architectural Overview

Quar Artist follows Figma's proven architecture pattern: a high-performance imperative rendering engine isolated from the React UI layer. The drawing engine operates as a standalone WebGPU/WebGL rendering loop, while React 18+ with TypeScript manages the surrounding interface (gallery, brush studio, layers panel, toolbars). State synchronization between the engine and React occurs only on high-level events (layer selection, tool change, brush parameter update), never on per-frame drawing operations.

#### 5.1.1 The Two-Canvas Architecture

Inspired by Excalidraw's rendering architecture, Quar Artist uses a dual-canvas approach:

- **Static Canvas** (PixiJS RenderTextures) — Holds the composited painting layers: the accumulated artwork.
- **Interactive Canvas** — Overlays the active brush preview, selection outlines, transform handles, guide overlays, and cursor visualization.

This separation ensures the accumulated artwork's complex compositing doesn't affect the real-time responsiveness of the active brush stroke.

#### 5.1.2 Rendering Backend Strategy

WebGPU is the primary target with WebGL 2.0 as automatic fallback. PixiJS v8 abstracts this, supporting both backends with a unified API.

| Component | WebGL 2.0 (Fallback) | WebGPU (Primary) |
|---|---|---|
| Execution Model | Single-threaded state machine | Multi-threaded command recording |
| Compute Shaders | Not supported (CPU fallback) | Fully supported (WGSL) |
| Memory Control | Browser-managed | Explicit resource management |
| Error Handling | Synchronous IPC calls | Asynchronous validation |
| Shader Language | GLSL ES 3.0 (string-based) | WGSL (tooling-first, modern hardware optimized) |
| Best For | Broad compatibility (~97% browsers) | Brush physics, filters, particle systems (~78% browsers) |

The introduction of **compute shaders** in WebGPU is transformative for features like brush physics and filter processing. A particle system with 100,000 particles that takes 30ms to update on the CPU in WebGL can be updated in under 2ms on the GPU with WebGPU — a **150× performance gain**.

The **desynchronized canvas hint** (`canvas.getContext('webgpu', { desynchronized: true })`) bypasses the DOM composition process and sends the canvas buffer directly to the display controller, significantly reducing input-to-pixel latency.

### 5.2 Core Engine Architecture

#### 5.2.1 Brush Rendering Pipeline

The brush engine uses a stamp-based approach: each stroke is rendered as a sequence of textured quads (stamps) positioned along a Catmull-Rom spline-interpolated path.

**Pipeline stages:**

1. **Input Capture:** `PointerEvent` with `getCoalescedEvents()` for 120Hz+ raw hardware points
2. **Stroke Smoothing:** Exponential smoothing (StreamLine) or rope algorithm (Stabilization) applied to raw points
3. **Path Interpolation:** Catmull-Rom spline generates intermediate stamp positions at configured spacing
4. **Stamp Rendering:** For each stamp position, a textured quad is drawn to the active layer's FBO with per-stamp parameters (size, opacity, rotation, scatter, color) derived from pressure/tilt/velocity mappings
5. **Compositing:** Active layer FBO composited with other layers using configured blend mode shader
6. **Display:** Final composited image rendered to the static canvas

**Dual-texture brushes** combine shape and grain textures in a two-texture WebGPU fragment shader, directly mirroring Procreate's architecture.

#### 5.2.2 Layer Compositor

Each layer is stored as a WebGPU/WebGL framebuffer object (FBO) with an RGBA color texture attachment. Layers are composited bottom-to-top using custom blend mode fragment shaders. The tile-based sparse layer system divides each layer into 256×256 tiles, only allocating GPU memory for tiles containing painted content. Empty tiles reference a shared transparent texture. This reduces a typical project's memory footprint by **60–80%**.

#### 5.2.3 Undo/Redo System

Pure snapshot-based undo is impractical (64MB per state at 4K × 50 states = 3.2GB). The **hybrid tile-based diffing approach** tracks which 256×256 tiles are "dirty" per operation and stores only changed tiles. A typical brush stroke's undo cost is ~5MB (20 affected tiles). With LZ4 compression and IndexedDB/OPFS offloading of older states, **100+ undo states** are achievable within browser memory constraints. The command pattern records operation metadata alongside tile diffs for efficient redo.

### 5.3 Input System

The W3C **Pointer Events Level 3** API provides: `pressure` (0–1 float), `tiltX`/`tiltY` (±90°), `twist` (0–359°), `tangentialPressure`, `altitudeAngle`/`azimuthAngle`, and `pointerType` ("pen"/"touch"/"mouse"). Browser support is universal since July 2020.

Key implementation details:

- **`getCoalescedEvents()`** — Returns intermediate pointer positions at up to 120Hz+, essential for smooth fast strokes. Chrome 58+, Firefox 59+, Edge 79+; Safari in progress.
- **`getPredictedEvents()`** — Provides predicted future positions for drawing-ahead, reducing perceived latency by 8–16ms.
- **Latency floor:** Web input latency is 16–33ms (1–2 frames at 60Hz) versus Procreate's native 9ms. Desynchronized canvas hint and predicted events partially mitigate this.
- **Touch rejection:** When `pointerType === 'pen'`, touch events are suppressed to prevent palm interference.

### 5.4 State Management

**Zustand** manages React UI state — tool selection, brush settings, layer panel, color picker — with minimal overhead (~3KB bundle vs Redux's ~30KB). Canvas pixel data and real-time pointer events remain in imperative state outside React's reconciliation cycle.

| State Domain | Storage Location | Update Frequency | React Involvement |
|---|---|---|---|
| Pixel data (layers) | WebGPU FBOs / tile cache | Per-frame (60–120Hz) | None (imperative) |
| Active stroke points | Engine internal buffer | Per pointer event (120Hz+) | None (imperative) |
| Tool/brush selection | Zustand store | On user action | Full (triggers re-render) |
| Layer metadata | Zustand store + IndexedDB | On layer operations | Full (layers panel update) |
| Color state | Zustand store | On color change | Full (picker update) |
| Project metadata | Dexie.js (IndexedDB) | On save/auto-save | Minimal (gallery update) |
| Undo/redo stack | Tile diff cache + OPFS | Per operation | Minimal (button state) |

### 5.5 File I/O & Persistence

| Concern | Technology | Rationale |
|---|---|---|
| Project storage | Origin Private File System (OPFS) | 2–4× faster than IndexedDB; synchronous access in Web Workers |
| Metadata DB | Dexie.js (IndexedDB wrapper) | Structured queries for gallery, settings, brush presets |
| PSD import/export | ag-psd (MIT) | Full PSD R/W with layers, blend modes, masks, text |
| Video export | FFmpeg.wasm (~25MB WASM) | Client-side MP4/WebM encoding for timelapse/animation |
| GIF export | gifenc | Lightweight GIF encoding for animation export |
| Image export | Canvas.toBlob() | Native PNG/JPEG encoding |
| .procreate import | JSZip + plist parser + LZO WASM | Parse ZIP archive with tile chunks |
| .qart native format | JSZip + JSON + LZ4 | Custom tile-based format with fast decompression |

To handle massive professional art files (sometimes exceeding 1GB), OPFS provides a high-performance, origin-specific virtual file system with synchronous file access within Web Workers, enabling import/export without locking the browser's main thread.

### 5.6 Collaboration Architecture

Real-time collaboration uses **Yjs CRDTs** for conflict-free synchronization of layer metadata, stroke operations, and cursor positions. A lightweight WebSocket relay server (y-websocket) broadcasts operations to connected clients. Each participant's stroke operations are applied locally first (optimistic updates), then confirmed/merged via CRDT resolution.

**Synchronized state:**

- Layer order, visibility, opacity, blend modes, lock states
- Stroke operations (add, erase) as operation logs
- Cursor positions and active tool indicators
- Selection state
- Per-user undo/redo scope

**NOT synchronized in real-time:** Pixel data. Only stroke operations are synchronized and replayed on each client's local canvas.

### 5.7 Performance Optimization Strategies

| Strategy | Technology | Impact |
|---|---|---|
| GPU-accelerated rendering | WebGPU / WebGL 2.0 via PixiJS v8 | 5–10× faster compositing than Canvas 2D |
| Off-main-thread compute | Web Workers + OffscreenCanvas | Prevents UI blocking during filter/export |
| WASM for hot paths | Rust via wasm-bindgen | Near-native speed for pixel iteration, LZ4, filters |
| SIMD instructions | WASM SIMD | 4× throughput for per-pixel operations |
| Tile-based rendering | 256×256 sparse tiles | 60–80% memory reduction vs full-layer allocation |
| Desynchronized canvas | `getContext({ desynchronized: true })` | Bypasses compositor, reducing display latency |
| Service Worker caching | Cache API + SW | Instant subsequent loads; offline capability |
| Lazy module loading | Dynamic `import()` | 3D painting, animation, WASM loaded on demand |

---

## 6. Technology Stack

| Layer | Technology | Version | License | Role |
|---|---|---|---|---|
| UI Framework | React + TypeScript | 18+ | MIT | Application shell, panels, dialogs |
| Rendering | PixiJS | v8+ | MIT | WebGL/WebGPU abstraction, RenderTextures, filters |
| State Management | Zustand | 4+ | MIT | UI state (tools, layers, color, settings) |
| Stroke Generation | perfect-freehand | 1.2+ | MIT | Pressure-sensitive stroke outlines |
| PSD I/O | ag-psd | latest | MIT | Read/write PSD with layers, masks, text |
| Video Export | FFmpeg.wasm | 0.12+ | LGPL | Client-side MP4/WebM/GIF encoding |
| GIF Export | gifenc | 1.0+ | MIT | Lightweight animated GIF encoding |
| Persistence | Dexie.js | 4+ | Apache | IndexedDB wrapper for metadata/settings |
| File System | OPFS | Native | W3C | High-perf binary file access in Workers |
| Collaboration | Yjs | 13+ | MIT | CRDT-based real-time document sync |
| Realtime Transport | y-websocket | latest | MIT | Collaboration server relay |
| 3D Rendering | Three.js (+ TSL) | r160+ | MIT | 3D model painting (v2.0) |
| Color Science | chroma.js | 2+ | BSD | Color space conversion, ICC profile support |
| WASM Compute | Rust (wasm-bindgen) | latest | MIT | Hot-path pixel operations, LZ4, filters |
| Build System | Vite | 5+ | MIT | Fast dev server, optimized production builds |
| Testing | Vitest + Playwright | latest | MIT | Unit + E2E + visual regression testing |

---

## 7. Development Roadmap

### 7.1 Phase 1: MVP (Months 1–6)

**Goal:** Establish the core painting experience. A user should be able to open Quar Artist in a browser, create a canvas, paint with 10–15 quality brushes using a stylus or mouse, manage layers, pick colors, select/transform regions, and export their work as PNG/JPEG/PSD.

#### Sprint 1–2: Foundation (Weeks 1–4)

- Project scaffolding: Vite + React 18 + TypeScript + PixiJS v8
- WebGPU/WebGL rendering context initialization with fallback detection
- Canvas component with pinch/zoom/rotate gesture handling via Pointer Events
- Basic brush engine: stamp-based rendering with pressure/tilt mapping
- 3 initial brushes: round pen, soft airbrush, hard eraser
- Single-layer painting with undo/redo (tile-based diffing, 50 states)

#### Sprint 3–4: Core Tools (Weeks 5–8)

- Layer system: create, delete, reorder, opacity, visibility, merge (up to 20 layers)
- 8 essential blending modes: Normal, Multiply, Screen, Overlay, Soft Light, Add, Color, Luminosity
- Alpha lock and clipping mask support
- Expand to 10–15 brushes: pencil, ink, watercolor, oil, marker, pastel, smudge, flat, round, airbrush
- StreamLine stroke stabilization (exponential smoothing)
- Color picker: disc, classic, value modes + hex input

#### Sprint 5–6: Selection & Export (Weeks 9–12)

- Selection tools: rectangle, ellipse, freehand, magic wand with feathering
- Transform: freeform, uniform with bilinear interpolation
- ColorDrop flood fill with adjustable threshold
- Color palettes: create, save, import/export as JSON
- Export: PNG, JPEG, PSD (via ag-psd)
- Project persistence: auto-save to IndexedDB/OPFS
- Gallery view with project thumbnails, create/delete/duplicate

#### Sprint 7–9: Polish (Weeks 13–18)

- Core adjustments: Gaussian blur, HSB, curves, sharpen
- Keyboard shortcuts (Ctrl+Z, B for brush, E for eraser, Space for pan, etc.)
- Responsive UI: tool panel, layer panel, color panel with collapsible sidebars
- Eyedropper tool (Alt+click + EyeDropper API where supported)
- Performance optimization: tile-based sparse layers, desynchronized canvas hint
- Cross-browser testing (Chrome, Firefox, Safari, Edge; iPad Safari)
- **Public beta launch**

### 7.2 Phase 2: Version 1.0 (Months 7–12)

**Goal:** Reach feature parity with mid-tier painting tools. Add advanced brush studio, drawing assists, full filter suite, animation, collaboration, and plugin API.

1. Full 26 blending modes via custom WebGPU/GLSL shaders
2. Advanced Brush Studio with 6+ parameter categories (stroke path, shape, grain, rendering, dynamics, stabilization)
3. Brush import/export (.qbrush format + .abr Photoshop import)
4. Drawing guides: 2D grid, isometric, 1/2/3-point perspective, symmetry (vertical/horizontal/quadrant/radial)
5. QuickShape with constraint modifiers and edit nodes
6. Full adjustment suite: liquify (4 core modes), chromatic aberration, gradient map, noise, bloom, glitch, halftone, motion blur, color balance
7. Animation Assist: frame-by-frame, onion skinning, FPS control, GIF/MP4 export
8. Text tool with system + custom font support via Font Access API
9. Real-time collaboration: Yjs + WebSocket with cursor presence, layer locking
10. Plugin API v1: JavaScript/WASM extension points for custom brushes, filters, and UI panels
11. QuickMenu: customizable radial menu with 8 configurable slots
12. Reference window: floating panel with canvas/image reference modes
13. Timelapse recording via MediaRecorder API with non-realtime capture
14. Cloud save with shareable project links

### 7.3 Phase 3: Version 2.0 (Months 13–24)

**Goal:** Approach Procreate-level quality with advanced brush simulation, 3D painting, and ecosystem features.

1. WebGPU compute shader pipeline for filters and advanced brush simulation
2. Wet media brush simulation (dilution, charge, attack, pull, grade, wet mix)
3. Dual brush system (shape + grain composite)
4. Advanced warp mesh and perspective transform
5. Full 8-mode Liquify (push, twirl L/R, pinch, expand, crystals, edge, reconstruct)
6. 3D model texturing on USDZ/OBJ meshes via Three.js WebGPU renderer with TSL shaders
7. PBR material painting (diffuse, metallic, roughness, normal maps)
8. Keyframe animation with easing curves and multi-track timeline
9. Audio timeline sync via Web Audio API
10. Community brush marketplace
11. Plugin API v2: deep engine hooks, custom render passes, AI integrations
12. Full .procreate file import (ZIP + plist + LZO WASM decoder)
13. Full PSD round-trip fidelity (smart objects, adjustment layers)
14. Mobile-optimized mode with virtual memory management for iPad Safari
15. CMYK workflow with ICC profile management

---

## 8. Known Web Platform Limitations & Mitigations

| # | Limitation | Impact | Mitigation Strategy |
|---|---|---|---|
| 1 | iOS Safari 256MB canvas memory limit | Caps layer count at high resolution (~4 layers at 4K) | Tile-based sparse layers; virtual layer paging to OPFS; auto-flatten inactive groups |
| 2 | No barrel roll / squeeze / double-tap APIs | Apple Pencil Pro features unavailable on web | Provide keyboard/button alternatives; document limitation |
| 3 | 16–33ms input latency floor | Perceptible lag vs. Procreate's 9ms native | `getPredictedEvents()` + desynchronized canvas; non-blocking pipeline |
| 4 | No haptic feedback API | Cannot provide tactile brush responses | Visual/audio feedback alternatives; accept as platform gap |
| 5 | Safari `getCoalescedEvents()` gaps | Reduced stroke smoothness on iOS Safari | Fallback to rAF interpolation; monitor WebKit progress |
| 6 | Background processing limits (iOS) | Tabs suspend when backgrounded | Save state aggressively; resume on reactivation |
| 7 | No Metal/PencilKit access | Cannot use Apple's GPU framework directly | WebGPU provides comparable pipeline model |
| 8 | WASM 4GB memory ceiling | Constrains complex compute operations | Streaming processing; chunked operations |
| 9 | Safari 7-day storage eviction | Script-writable storage may be purged | Request persistent storage permission; cloud sync backup |
| 10 | Max WebGL texture size (4096×4096 on older) | Limits canvas on older devices | Tile-based rendering handles any size; detect `maxTextureSize` |

---

## 9. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| WebGPU adoption stalls | Low | High | WebGL 2.0 fallback built into architecture via PixiJS v8 |
| Brush quality gap too large | Medium | High | Invest heavily in brush engine R&D during MVP; hire artist consultants |
| iOS Safari memory crashes | High | Medium | Tile-based architecture with aggressive paging; test on all iPad models |
| Performance perception gap | Medium | High | Benchmark against Procreate; target <20ms stroke latency |
| Community adoption slow | Medium | Medium | Ship with 50+ default brushes; create tutorial content; engage art communities |
| Collaboration sync conflicts | Low | Medium | Yjs CRDT proven at scale (Figma, Notion); per-layer locking as fallback |
| Plugin API security concerns | Medium | Medium | Sandboxed iframe execution; permission model for API access |
| File format compatibility | Medium | Low | Comprehensive PSD test suite; .procreate import as best-effort |

---

## 10. Success Metrics & KPIs

### 10.1 MVP Success Criteria (Month 6)

| Metric | Target | Measurement Method |
|---|---|---|
| Stroke-to-pixel latency | <25ms desktop, <40ms iPad Safari | `Performance.now()` instrumentation |
| Layer compositing (20 layers, 2K) | <16ms per frame (60fps) | `requestAnimationFrame` profiling |
| Brush stroke quality | 4/5 blind test rating vs Procreate by 10 artists | User testing panel |
| PSD export fidelity | 95%+ visual match with Photoshop | Automated pixel-diff testing |
| Browser compatibility | Chrome, Firefox, Safari, Edge + iPad Safari | CI cross-browser test suite |
| Public beta users | 500+ monthly active | Analytics dashboard |
| GitHub stars | 200+ | GitHub metrics |

### 10.2 Version 1.0 Success Criteria (Month 12)

| Metric | Target | Measurement Method |
|---|---|---|
| Monthly active users | 5,000+ | Analytics dashboard |
| Collaboration sessions | 100+ multi-user sessions/month | Server telemetry |
| Plugin ecosystem | 10+ community plugins | Plugin registry |
| Brush library | 100+ default + 50+ community brushes | Brush marketplace catalog |
| Community contributions | 20+ external PRs merged | GitHub contributor metrics |
| Procreate feature parity | 70%+ features implemented | Feature audit checklist |
| Artist satisfaction | 4.0/5.0 average rating | In-app feedback survey |

### 10.3 Version 2.0 Success Criteria (Month 24)

| Metric | Target | Measurement Method |
|---|---|---|
| Monthly active users | 25,000+ | Analytics dashboard |
| Procreate switchers | 1,000+ users primarily switching | Onboarding survey |
| Plugin ecosystem | 100+ plugins, 5+ premium | Plugin registry + marketplace |
| Enterprise/education adoption | 10+ organizations | License/usage tracking |
| Performance parity | <20ms stroke latency on desktop | Continuous benchmarking |
| Open-source health | 50+ contributors, <48hr avg issue response | GitHub Insights |

---

## 11. Appendices

### 11.1 Glossary

| Term | Definition |
|---|---|
| CRDT | Conflict-free Replicated Data Type; data structure enabling concurrent edits without conflicts |
| FBO | Framebuffer Object; GPU-side render target for off-screen rendering and layer compositing |
| GLSL | OpenGL Shading Language; C-like shader language used in WebGL |
| WGSL | WebGPU Shading Language; modern shader language designed for WebGPU |
| LZO / LZ4 | Fast lossless compression algorithms optimized for decompression speed |
| OPFS | Origin Private File System; high-performance browser file system API |
| PBR | Physically Based Rendering; realistic lighting model for 3D surfaces |
| Stamp-based rendering | Brush technique where strokes are composed of repeated texture "stamps" along a path |
| Tile-based rendering | Dividing canvas into small chunks (e.g., 256×256) for efficient memory management |
| TSL | Three Shading Language; cross-platform shader abstraction in Three.js for WebGL/WebGPU |
| Valkyrie | Procreate's proprietary 64-bit painting engine built on Apple's Metal API |

### 11.2 Key References

- Procreate Handbook — help.procreate.com/procreate/handbook
- Procreate Dreams Handbook — help.procreate.com/dreams
- WebGPU Specification — gpuweb.github.io/gpuweb
- Pointer Events API (W3C) — w3c.github.io/pointerevents
- PixiJS v8 Documentation — pixijs.com/8.x/guides
- Yjs CRDT Framework — docs.yjs.dev
- ag-psd (PSD Library) — github.com/Agamnentzar/ag-psd
- Klecks (Open Source Painting) — github.com/bitbof/klecks
- Figma Architecture Blog — figma.com/blog/webassembly-cut-figmas-load-time-by-3x
- Krita Brush Engine Wiki — community.kde.org/Krita/BrushEngine
- perfect-freehand Library — github.com/steveruizok/perfect-freehand
- Dexie.js (IndexedDB) — github.com/dexie/Dexie.js
- Excalidraw Rendering Architecture — deepwiki.com/zsviczian/excalidraw/6.1-rendering-architecture

---

*QUAR Artist PRD v1.0 — February 2026 — QUAR Suite*
