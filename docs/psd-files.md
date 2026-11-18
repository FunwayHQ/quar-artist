# PSD files

QUAR Artist writes PSD files for Photoshop and other apps, and opens the PSD and PSB files they make (plan M1.7). Both run in the files worker (`io/formats/fileWorker.ts`), as .qart files do. The worker loads [ag-psd](https://github.com/Agamnentzar/ag-psd), which reads and writes the format, only when a PSD file is exported or opened.

## Exporting

**Export… › PSD** downloads `<project name>.psd`. It has:

| What | How |
|---|---|
| Every layer, bottom to top | Each only as large as its paint, at its place on the canvas. An empty layer takes no room. Names over 256 characters are cut |
| Blend mode | Each of the app's modes under its Photoshop name |
| Opacity, visibility, clipping | As in the app |
| Alpha lock | Photoshop's Lock transparent pixels |
| Lock | Photoshop's Lock image pixels and Lock position |
| The selected layer | Selected when the file opens |
| Resolution | In pixels per inch |
| The composite | What the canvas shows, with its transparency. Apps that read only the composite, such as image viewers and file previews, show it |

The file is 8-bit RGB, straight alpha, which every app that reads PSD files can open. ag-psd compresses the composite of an image 1 or 2 px wide into too small a buffer and cuts it short, so the writer stores those composites uncompressed.

Not exported, with a toast that says why:

- while a transform or filter is previewed: the layers would be written without it, and the composite with it. Apply or cancel it, then export again;
- a file over 2 GB, more than a PSD file holds: a .qart file holds the project, or merging some layers makes the file smaller.

Not in the file yet:

- groups and layer masks, which come with layer groups (M7.1);
- an ICC profile. A Display P3 project's colours are written as they are, without one, so other apps take them for sRGB;
- choosing where the file goes: like PNG and JPEG export, it is a download.

## Opening

**File › Open…**, the Gallery's **Import…** and dropping a file open `.psd` and `.psb` files as new projects, named after the file. A PSD file is never linked to its project the way a .qart file is: Ctrl+S saves in the browser, and never writes to the file.

What the file keeps:

- every layer with pixels, in its place, cut at the canvas's edges;
- names, blend modes, opacity, visibility, clipping, Lock transparent pixels (alpha lock) and Lock image pixels (lock);
- the selected layer, or the top layer if none is;
- the resolution, in pixels per inch, which is how Photoshop stores it whichever unit it shows.

What changes:

- **Groups** become plain layers in their place. A hidden group's layers are hidden, and a group's opacity multiplies into its layers' opacity. Photoshop fades a group as a whole, and its layers now fade one by one, so where they overlap in a group at less than 100%, the lower ones show through the upper ones a little. A group's own blend mode is dropped; its layers keep theirs. A group's masks and layer effects are left out, so what its masks hid shows.
- **Layer masks** are applied to the layer's pixels: they hide what the mask hid, and can't be edited as masks.
- **Fill opacity** multiplies into the opacity.
- **Color Overlay** in Normal mode, on a Normal layer at 100% fill, colours the layer's pixels as Photoshop shows them.
- **16- and 32-bit files** become 8-bit. 32-bit colours are in linear light, so they go through the sRGB curve; their alpha doesn't. Photoshop blends a 32-bit file's layers in linear light, and the app blends them as it blends any layers, so where they are partly transparent, as at soft edges, they look a little different.
- **Grayscale, Indexed and Bitmap files** open in RGB: Indexed ones through their palette.
- **A file without layers**, or with only groups and adjustment layers, opens as one layer, Background, of its composite image. A channel after its colours is its transparency only when the file says so, as Photoshop reads it; otherwise it is a saved selection, and the image opens opaque. Photoshop mattes a transparent composite's colours against white, and the matte is taken out.

Left out, and a toast says which and how many:

- adjustment layers;
- layer effects, of layers and of groups, other than the Color Overlay above;
- group masks: what a group's layer mask or vector mask hid shows;
- layers' vector masks, unless Photoshop saved them as pixels too;
- blend modes the app doesn't have: Linear Burn, whose layers become Normal.

Left out, and not said yet:

- Blend If, in a layer's Blending Options: the layer shows whole;
- a group's clipping: its layers aren't clipped to the layer below it;
- artboards' background colours: what is behind their layers is transparent;
- an ICC profile: the file's colours are taken as sRGB (M7.3).

Text, smart object, fill and shape layers open as the pixels Photoshop saved for them.

Refused, with a toast that says why:

| The file | The toast says |
|---|---|
| Isn't a PSD or PSB file, or is damaged | it isn't a PSD file, or it is damaged |
| Is in CMYK, Lab, Multichannel or Duotone | it is in CMYK color, which QUAR Artist can't open. Convert it to RGB in the app that made it, then open it again |
| Has more layers, once groups are flattened, than the app can have (20) | it has 29 layers, and QUAR Artist can have up to 20. Merge some in the app that made it, then open it again |
| Is larger than the device's canvases (8192 px a side on desktops, 4096 on phones and tablets), has a layer or mask with more pixels than such a canvas, or is over 2 GiB | it is too large to open on this device |

The size and colour mode come from the file's header, and the layer count from its structure, before any pixels are read. Every layer's and mask's rectangle is checked before any channel is decoded.

The reader decodes each channel itself (`io/formats/psd/psdPixels.ts`): raw, RLE, ZIP or ZIP with prediction, at 8, 16 or 32 bits. ag-psd reads 16-bit samples with their bytes swapped, and RLE ones only at 8 bits. Each channel goes into a buffer the size of its rectangle, and a damaged one is refused rather than opened with made-up pixels:

- RLE rows that claim more bytes than the file has are found before any is unpacked;
- a ZIP-compressed channel is unpacked 16 KiB at a time and refused once it passes its size. A 64 MiB "zip bomb" in a 2 × 2 layer stops within its first 16 KiB, where ag-psd would unpack it whole;
- ag-psd, which reads the rest of the file, is stopped where it would read past the end. There it would make up zeros, up to 100 MB of them.

## Fidelity

`e2e/gpu/psd.spec.ts` opens PSD files saved by Photoshop (`e2e/fixtures/psd`, from ag-psd's tests) with the app's reader, draws them with the real engine, and compares each pixel with the composite Photoshop saved in the file. A pixel matches when its alpha, and its colour times its alpha, are within 3 levels of Photoshop's. The PRD's target is 95% of pixels (10.1).

Measured on 2026-11-18, the same on Chromium (WebGL 2 and WebGPU), Firefox and WebKit:

| File | Saved by | Pixels that match |
|---|---|---|
| `layers.psd` | Photoshop CS6 | 100% |
| `groups.psd` | Photoshop CS6 | 100% |
| `background.psd` | Photoshop CS6 | 100% |
| `layer-mask.psd` | Photoshop CS6 | 100% |
| `layer-larger-than-drawing.psd` | Photoshop CS6 | 100% |
| `just-bg.psd` | Photoshop CS6 | 100% |
| `grayscale.psd` | Photoshop CS6 | 100% |
| `text-layer.psd` | Photoshop CS6 | 97.48% |
| `nested.psd` | Photoshop CC 2019 | 100% |

The text layer file matches 97.48% on the CPU reference too: the pixels Photoshop saved for the text layer differ a little from the composite saved with them.

`16-bit.psd` and `32-bit.psd` were saved by Photoshop CS6 without Maximize Compatibility, so their composites are blank, and `io/formats/psd/PsdReader.test.ts` checks pixels of their layers instead. The 16-bit layer is the same as ag-psd's image of it wherever it is opaque, and within 2 levels of colour times alpha at its edges. Photoshop saved a thumbnail of the 32-bit file. Blended in linear light, as Photoshop blends them, the 32-bit layers are within that thumbnail's JPEG noise: 3.7 levels on average. Blended as the app blends layers, they are 9 levels off.

Blend modes are compared with `2026-blend-modes.psd`, saved by Photoshop 27.7: a square in each of Photoshop's 27 modes over grey, each with a Color Overlay in its own mode. The test draws the same layers and compares each square with Photoshop's. Every mode the app has matches within 3 levels, except:

- Hue, which draws as Normal (F15, M2.4);
- Vivid Light, up to 7 levels off: rgba(218, 251, 255) where Photoshop draws rgba(211, 248, 255) (F107, M2.4).

Dissolve is random, so no two drawings of it agree. The app has no Linear Burn.

The file has 29 layers, more than the app opens, so it is refused when opened in the app (`e2e/files.spec.ts`).
