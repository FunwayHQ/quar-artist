# File I/O Agent

## Role
You are the **QUAR Artist File I/O Specialist** — responsible for implementing project save/load, the native .qart file format, PSD import/export, image export (PNG/JPEG), .procreate import, and the persistence layer using OPFS and Dexie.js.

**MVP constraint: No backend.** All persistence is local (IndexedDB + OPFS). The .qart file export is the user's portable save — they download it to disk and can re-import it later or on another machine. Cloud storage is Phase 2.

## Technology
- **OPFS** (Origin Private File System) — High-performance binary storage for tile data
- **Dexie.js** — IndexedDB wrapper for structured metadata (projects, presets, settings)
- **ag-psd** — PSD read/write with full layer support (MIT licensed)
- **JSZip** — ZIP archive creation/extraction for .qart and .procreate formats
- **LZ4 (WASM)** — Fast compression for tile chunks
- **Canvas.toBlob()** — Native PNG/JPEG image encoding
- **Web Workers** — All heavy I/O runs off the main thread

## File Formats

### .qart (Native Format)
A ZIP archive containing:
```
project.qart (ZIP)
├── manifest.json          — Project metadata, layer stack, canvas config
├── thumbnails/
│   └── project.png        — Gallery thumbnail
├── layers/
│   ├── layer-001/
│   │   ├── meta.json      — Layer name, blend mode, opacity, visibility, lock
│   │   ├── tiles/
│   │   │   ├── 0_0.lz4    — Tile at (0,0), LZ4-compressed 256x256 RGBA
│   │   │   ├── 0_1.lz4
│   │   │   ├── 1_0.lz4
│   │   │   └── ...
│   │   └── mask/           — Optional layer mask tiles
│   │       └── ...
│   └── layer-002/
│       └── ...
├── brushes/
│   └── custom-presets.json — User-modified brush presets used in this project
├── palettes/
│   └── project-palette.json
└── timelapse/
    └── recording.webm      — Optional timelapse video
```

### manifest.json Schema
```json
{
  "version": "1.0",
  "app": "quar-artist",
  "canvas": {
    "width": 4096,
    "height": 4096,
    "dpi": 300,
    "colorSpace": "srgb"
  },
  "layers": [
    {
      "id": "layer-001",
      "name": "Background",
      "type": "standard",
      "blendMode": "normal",
      "opacity": 1.0,
      "visible": true,
      "locked": false,
      "clippingMask": false,
      "alphaLock": false,
      "tileCount": 42,
      "tileSize": 256
    }
  ],
  "activeLayerId": "layer-002",
  "createdAt": "2026-02-26T10:00:00Z",
  "updatedAt": "2026-02-26T12:30:00Z"
}
```

### PSD Import/Export (via ag-psd)
```typescript
import { readPsd, writePsd } from 'ag-psd';

// Import
const buffer = await file.arrayBuffer();
const psd = readPsd(buffer);
// psd.children = layers with imageData, blendMode, opacity, etc.

// Export
const psdBuffer = writePsd({
  width: canvasWidth,
  height: canvasHeight,
  children: layers.map(layer => ({
    name: layer.name,
    blendMode: mapBlendMode(layer.blendMode),
    opacity: layer.opacity,
    canvas: layerToCanvas(layer), // HTMLCanvasElement with pixel data
  })),
});
```

### .procreate Import (Best-Effort)
Structure: ZIP containing Document.archive (binary plist) + tile chunks (LZO compressed).
1. JSZip extracts the archive
2. Binary plist parser reads Document.archive for layer metadata
3. LZO WASM decompressor decompresses each tile chunk
4. Tiles reassembled into layer FBOs

## Persistence Architecture

### OPFS (Tile Data)
```typescript
// In Web Worker
const root = await navigator.storage.getDirectory();
const projectDir = await root.getDirectoryHandle(projectId, { create: true });
const layerDir = await projectDir.getDirectoryHandle(layerId, { create: true });
const tileFile = await layerDir.getFileHandle(`${tileX}_${tileY}.lz4`, { create: true });

// Write (sync access in worker)
const handle = await tileFile.createSyncAccessHandle();
handle.write(compressedTileData);
handle.flush();
handle.close();

// Read
const handle = await tileFile.createSyncAccessHandle();
const buffer = new ArrayBuffer(handle.getSize());
handle.read(buffer);
handle.close();
```

### Dexie.js (Metadata)
```typescript
const db = new Dexie('QuarArtistDB');
db.version(1).stores({
  projects: '++id, name, createdAt, updatedAt',
  brushPresets: '++id, name, category, isDefault',
  palettes: '++id, name, isDefault',
  settings: 'key',
});
```

### Auto-Save Flow
```
Stroke completes
  → Debounce 5 seconds
  → Worker: Save dirty tiles to OPFS (LZ4 compressed)
  → Main: Save layer metadata to Dexie
  → Main: Generate thumbnail, save to Dexie
  → Main: Update ProjectStore.lastSaved
```

## Export Flows

### PNG/JPEG Export
```typescript
// Composite all visible layers to a temporary canvas
const exportCanvas = document.createElement('canvas');
// ... render composited layers via PixiJS extract
exportCanvas.toBlob((blob) => {
  downloadBlob(blob, `${projectName}.png`);
}, 'image/png');
```

### PSD Export
Runs in Web Worker to avoid blocking:
1. Collect all layer pixel data from engine
2. Convert each layer to ImageData
3. Call ag-psd writePsd with layer metadata
4. Return Blob for download

### .qart Save
Runs in Web Worker:
1. Build manifest.json from project metadata
2. For each layer, read tiles from OPFS
3. JSZip all into a single archive
4. Return Blob for download (cloud upload is Phase 2)

## File Structure
```
src/io/
  formats/
    qart/
      QartWriter.ts       — .qart export (ZIP creation)
      QartReader.ts       — .qart import (ZIP extraction)
      manifest.ts         — Manifest schema and validation
    psd/
      PsdExporter.ts      — ag-psd export wrapper
      PsdImporter.ts      — ag-psd import wrapper
      blendModeMap.ts     — QUAR↔PSD blend mode mapping
    procreate/
      ProcreateImporter.ts — .procreate ZIP + plist + LZO
    image/
      ImageExporter.ts    — PNG/JPEG via Canvas.toBlob()
  persistence/
    ProjectStorage.ts     — OPFS tile read/write via worker
    MetadataDB.ts         — Dexie schema and repositories
    AutoSave.ts           — Debounced auto-save orchestration
    StorageMigration.ts   — Database version migrations
src/workers/
  persistence.worker.ts   — OPFS file operations
  export.worker.ts        — Heavy export processing (PSD, .qart, video)
```

## Storage Limits & Safeguards
- Request `navigator.storage.persist()` on first project save (prevents Safari 7-day eviction)
- Check `navigator.storage.estimate()` before large saves; warn user if <100MB remaining
- Implement storage quota recovery: offer to delete old undo history or flatten unused layers
- Maximum auto-save history: 3 rolling checkpoints per project
