# The .qart file format, version 1

A `.qart` file holds one QUAR Artist document: every layer as the app has it, with the document's settings, so that it opens again in QUAR Artist in any browser. QUAR Artist writes it with File › Save as .qart… and opens it with File › Open…, by dropping it on the canvas, or by importing it in the Gallery.

The file is a ZIP archive. This page describes version 1 of its contents, and how readers treat the files written before it.

## Entries

| Entry | Contents |
|---|---|
| `manifest.json` | The document: its size, its layers and its settings, as UTF-8 JSON. Always present, and written first. |
| `tiles/<layerId>/<x>_<y>.raw` | One 256 × 256 tile of a layer, at column `x` and row `y` of the layer's tile grid, counted from 0 at the top left. Only tiles with at least one pixel that isn't fully transparent are written. |
| `thumbnail.png` | Optional. The whole document scaled to at most 400 px on its longer side, for file browsers and previews. Readers don't need it. |
| `timelapse.webm` | Optional. A recording of the painting, named by the manifest. Not written yet (plan M7.7). |

Entries are compressed with DEFLATE, or stored as they are. Entry names are UTF-8.

Readers skip entries they don't know, and folder entries (names ending in `/`), so later versions can add entries without breaking earlier readers. The `tiles/` folder is the exception: every entry in it must be a tile, named as above. A reader refuses a file with anything else there.

## The archive

Version 1 files are plain ZIP archives:
- no ZIP64, so a file is smaller than 4 GiB and has at most 65,535 entries;
- one disk;
- no encryption.

Readers find entries through the central directory at the end of the archive, and check each one against its local header. They refuse an archive whose entries overlap, or aren't where the directory says. They check every entry they read against its CRC-32.

## Tiles

A layer is cut into a grid of 256 × 256 tiles: `ceil(width / 256)` columns and `ceil(height / 256)` rows. A tile missing from the archive is fully transparent.

Tile names give the column and row in decimal, without leading zeros: `tiles/sky/0_0.raw`, `tiles/sky/12_3.raw`. So a tile has one name only.

Each tile entry is exactly 262,144 bytes:
- 256 rows, top to bottom, of 256 pixels, left to right;
- each pixel is R, G, B and A, one byte each, in the document's colour space;
- alpha is premultiplied: each colour channel is already multiplied by alpha (`round(c × a / 255)`), as the GPU holds it. A fully transparent pixel is 0, 0, 0, 0.

Tiles at the right and bottom edges are whole tiles too. Their part past the document's edge is written as zeros, and readers ignore it.

The `raw` codec stores the tile's bytes as they are; the ZIP entry's own DEFLATE compresses them. The manifest's `tiles.codec` names the codec, and the entry's extension matches it. A later version may add codecs, such as LZ4 (plan M2.6).

## manifest.json

```json
{
  "format": "qart",
  "formatVersion": 1,
  "app": { "name": "QUAR Artist", "version": "0.1.0" },
  "name": "Sunset",
  "createdAt": "2026-11-17T10:00:00.000Z",
  "updatedAt": "2026-11-17T12:30:00.000Z",
  "canvas": { "width": 1920, "height": 1080, "dpi": 144, "colorSpace": "srgb" },
  "tiles": { "size": 256, "format": "rgba8", "alpha": "premultiplied", "codec": "raw" },
  "layers": [
    {
      "type": "layer",
      "id": "5b1f0c9e-7d3a-4c43-9a51-2f6a8e0d4b17",
      "name": "Background",
      "blendMode": "normal",
      "opacity": 1,
      "visible": true,
      "locked": false,
      "alphaLock": false,
      "clippingMask": false
    }
  ],
  "activeLayerId": "5b1f0c9e-7d3a-4c43-9a51-2f6a8e0d4b17",
  "guides": null,
  "thumbnail": "thumbnail.png",
  "timelapse": null
}
```

| Field | Meaning |
|---|---|
| `format` | Always `"qart"`. |
| `formatVersion` | `1`. Readers refuse a version they don't know: a newer file may hold what they can't show. |
| `app` | The app and version that wrote the file. For information only. |
| `name` | The project's name when the file was written, up to 256 characters. QUAR Artist names an opened project after its file instead, as the user sees it. |
| `createdAt`, `updatedAt` | When the project was made and last changed, as ISO 8601 times. Optional. |
| `canvas.width`, `canvas.height` | The document's size in pixels: whole numbers from 1 to 16,384. QUAR Artist opens what the device supports, currently up to 8,192 on desktops and 4,096 on phones and tablets. |
| `canvas.dpi` | Pixels per inch, from 1 to 10,000. |
| `canvas.colorSpace` | `"srgb"` or `"display-p3"`. |
| `tiles` | How every tile is stored: `size` 256, `format` `"rgba8"`, `alpha` `"premultiplied"`, `codec` `"raw"`. Readers refuse other values. |
| `layers` | The layers, bottom first. In version 1 every entry is a layer (`"type": "layer"`). Groups come with a later version (plan M7.1). |
| `layers[].id` | Unique in the file: 1 to 64 letters, digits, `-` or `_`. It names the layer's tile folder. |
| `layers[].name` | Up to 256 characters. Readers cut a longer name. |
| `layers[].blendMode` | One of `normal`, `darken`, `multiply`, `colorBurn`, `lighten`, `screen`, `colorDodge`, `add`, `overlay`, `softLight`, `hardLight`, `vividLight`, `linearLight`, `pinLight`, `hardMix`, `difference`, `exclusion`, `subtract`, `divide`, `hue`, `saturation`, `color`, `luminosity`, `darkerColor`, `lighterColor`, `dissolve`. |
| `layers[].opacity` | From 0 to 1. |
| `layers[].visible`, `locked`, `alphaLock`, `clippingMask` | Booleans. A clipping layer is clipped to the first layer below it that isn't one. |
| `activeLayerId` | The id of the selected layer: one of the layers'. |
| `guides` | The drawing guides and symmetry: the Drawing Guides dialog's settings (`DocumentGuides` in `src/types/guides.ts`), or `null` for none. A field that is missing or out of range takes its default when read. |
| `thumbnail` | The thumbnail's entry name, or `null` when there is none. |
| `timelapse` | `null` in version 1 files written now. Reserved for the recording. |

## Limits readers enforce

The limits protect a reader from files made to exhaust its memory. Each is checked from the central directory and the manifest before any pixels are read.

- `manifest.json` inflates to at most 1 MiB.
- At most 1,000 layers. QUAR Artist opens up to its own layer limit, currently 20, and refuses a file with more rather than leave some out.
- Every tile entry declares its size as exactly 262,144 bytes.
- An entry's compressed data is at most its size plus an eighth, plus 1 KiB. No encoder makes more, so a reader never reads much more than an entry gives it.
- A reader stops inflating an entry once its output passes the size the entry declares, whatever the compressed data says. QUAR Artist checks after every 16 KiB of compressed data.
- Since each tile has one name, in a grid the manifest gives, a file inflates to at most its layers' tile grids, at 262,144 bytes a tile, and the manifest. QUAR Artist reads no other entry.
- A reader should only open documents whose layers fit in the memory it has: layers × width × height × 4 bytes. QUAR Artist opens a document as large as any it can make itself, up to its layer limit at its largest canvas, so a file it wrote always opens again.
- A file is refused when it has:
  - two entries with the same name;
  - an entry under `tiles/` that isn't a tile of one of its layers, inside the layer's grid;
  - two layers with the same id;
  - an `activeLayerId` that isn't one of them.

## Damaged files

An entry inflated past its declared size refuses the whole file: it was made that way, not damaged.

A tile whose data is damaged is left out. Its data may not inflate, inflate to less than its size, or not match its checksum. QUAR Artist then opens the file with that tile transparent, and says how many tiles it couldn't read. Ctrl+S doesn't write to that file afterwards, since the file may still have what was lost.

## Writing files

QUAR Artist writes the entries in order: `manifest.json`, `thumbnail.png`, then each layer's tiles, bottom layer first, row by row. It compresses each entry with DEFLATE at level 6, unless that would make it larger, and stores the thumbnail as it is. When a thumbnail can't be made within 10 seconds, the file is written without one.

What a reader would refuse is put right as the file is written:
- a layer whose id isn't valid, or is another layer's, gets a fresh one (`layer-1`, `layer-2`…);
- names are cut to 256 characters, without cutting a character of two UTF-16 units in half;
- opacity and resolution are brought into range;
- an unknown blend mode becomes `normal`.

## Files written before version 1

QUAR Artist wrote a draft layout before version 1, up to 2026-11-17. Its manifest has `"version": "1.0"` and no `formatVersion`. Each layer is whole, in the entry its `dataFile` names (`layers/<id>.bin`): straight-alpha RGBA8 at the document's size, without tiles. The manifest's `order` gives the layers' order, bottom first.

Readers open these files too, with the same limits on sizes. Each layer entry must declare exactly `width × height × 4` bytes. A layer whose data is damaged opens transparent, counted as all of its tiles. When `activeLayerId` is none of the layers, the top layer is selected.
