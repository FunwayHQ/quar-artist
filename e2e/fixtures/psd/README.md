# PSD fidelity files

PSD files saved by Adobe Photoshop, most of them with the composite image Photoshop rendered for it. `e2e/gpu/psd.spec.ts` opens each of those in QUAR Artist and compares what QUAR Artist draws with Photoshop's composite (plan M1.7, PRD 10.1).

The 16- and 32-bit files were saved without Maximize Compatibility, so their composites are blank. `src/io/formats/psd/PsdReader.test.ts` checks pixels of their layers instead.

| File | Saved by | What it has |
|---|---|---|
| `layers.psd` | Photoshop CS6 | Three layers, one of them empty |
| `groups.psd` | Photoshop CS6 | A group of two layers and a hidden, empty group at 50% opacity, over a layer |
| `background.psd` | Photoshop CS6 | A layer over a Background layer, which Photoshop keeps alpha-locked |
| `layer-mask.psd` | Photoshop CS6 | A layer mask that hides the layer outside its rectangle |
| `layer-larger-than-drawing.psd` | Photoshop CS6 | A layer that extends past the top of the canvas |
| `just-bg.psd` | Photoshop CS6 | No layers: only the composite image |
| `grayscale.psd` | Photoshop CS6 | Grayscale colour mode, with an empty layer |
| `text-layer.psd` | Photoshop CS6 | A text layer, which opens as its pixels |
| `nested.psd` | Photoshop CC 2019 | A layer in ten groups, one inside another |
| `2026-blend-modes.psd` | Photoshop 27.7 | A square for each of Photoshop's 27 blend modes over grey, each with a Color Overlay in its own mode |
| `16-bit.psd` | Photoshop CS6 | A turned photo of a fox at 16 bits a channel, ZIP-compressed with prediction |
| `32-bit.psd` | Photoshop CS6 | Two layers at 32 bits a channel, in linear light, ZIP-compressed with prediction, one with soft brush strokes |

They come from the test files of [ag-psd](https://github.com/Agamnentzar/ag-psd) (`test/read/<name>/src.psd`, where the 16- and 32-bit files are `16bits` and `32bits`), which are under its MIT licence:

```
The MIT License (MIT)

Copyright (c) 2016 Agamnentzar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
