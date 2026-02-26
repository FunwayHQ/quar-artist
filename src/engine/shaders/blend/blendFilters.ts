import { Filter, GlProgram, GpuProgram } from 'pixi.js'
import type { BlendMode } from '../../../types/layer.ts'

/**
 * GLSL fragment source for custom blend modes.
 * Each takes uSampler (source layer) and uBackbuffer (destination/layers below).
 * The vertex shader is PixiJS default.
 */

const VERTEX = `
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vTextureCoord;
  out vec2 vFilterCoord;

  uniform vec4 uInputSize;
  uniform vec4 uOutputFrame;
  uniform vec4 uOutputTexture;

  vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
  }

  vec2 filterTextureCoord(void) {
    return aUV * (uOutputFrame.zw * uInputSize.zw);
  }

  void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vFilterCoord = vTextureCoord;
  }
`

function makeBlendFragment(blendFormula: string): string {
  return `
    in vec2 vTextureCoord;
    in vec2 vFilterCoord;
    out vec4 finalColor;

    uniform sampler2D uTexture;
    uniform sampler2D uBackTexture;
    uniform float uLayerOpacity;

    ${blendFormula}

    void main(void) {
      vec4 src = texture(uTexture, vTextureCoord);
      vec4 dst = texture(uBackTexture, vFilterCoord);

      // Premultiplied -> straight alpha for blending math
      vec3 srcRGB = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
      vec3 dstRGB = dst.a > 0.0 ? dst.rgb / dst.a : vec3(0.0);

      vec3 blended = blend(srcRGB, dstRGB);

      float srcA = src.a * uLayerOpacity;
      vec3 resultRGB = mix(dstRGB, blended, srcA);
      float resultA = dst.a + srcA * (1.0 - dst.a);

      // Back to premultiplied
      finalColor = vec4(resultRGB * resultA, resultA);
    }
  `
}

const MULTIPLY_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return src * dst;
  }
`

const SCREEN_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return 1.0 - (1.0 - src) * (1.0 - dst);
  }
`

const OVERLAY_FORMULA = `
  float overlayChannel(float s, float d) {
    return d < 0.5 ? 2.0 * s * d : 1.0 - 2.0 * (1.0 - s) * (1.0 - d);
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      overlayChannel(src.r, dst.r),
      overlayChannel(src.g, dst.g),
      overlayChannel(src.b, dst.b)
    );
  }
`

const SOFT_LIGHT_FORMULA = `
  float softLightChannel(float s, float d) {
    if (s <= 0.5) {
      return d - (1.0 - 2.0 * s) * d * (1.0 - d);
    } else {
      float g = d <= 0.25
        ? ((16.0 * d - 12.0) * d + 4.0) * d
        : sqrt(d);
      return d + (2.0 * s - 1.0) * (g - d);
    }
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      softLightChannel(src.r, dst.r),
      softLightChannel(src.g, dst.g),
      softLightChannel(src.b, dst.b)
    );
  }
`

const ADD_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return min(src + dst, vec3(1.0));
  }
`

const COLOR_FORMULA = `
  vec3 rgbToHsl(vec3 c) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float l = (maxC + minC) / 2.0;
    float s = 0.0;
    float h = 0.0;
    if (maxC != minC) {
      float d = maxC - minC;
      s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
      if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, s, l);
  }
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
  }
  vec3 hslToRgb(vec3 hsl) {
    if (hsl.y == 0.0) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    return vec3(
      hue2rgb(p, q, hsl.x + 1.0/3.0),
      hue2rgb(p, q, hsl.x),
      hue2rgb(p, q, hsl.x - 1.0/3.0)
    );
  }
  vec3 blend(vec3 src, vec3 dst) {
    vec3 srcHsl = rgbToHsl(src);
    vec3 dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3(srcHsl.x, srcHsl.y, dstHsl.z));
  }
`

const LUMINOSITY_FORMULA = `
  vec3 rgbToHsl(vec3 c) {
    float maxC = max(c.r, max(c.g, c.b));
    float minC = min(c.r, min(c.g, c.b));
    float l = (maxC + minC) / 2.0;
    float s = 0.0;
    float h = 0.0;
    if (maxC != minC) {
      float d = maxC - minC;
      s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
      if (maxC == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
      else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
      else h = (c.r - c.g) / d + 4.0;
      h /= 6.0;
    }
    return vec3(h, s, l);
  }
  float hue2rgb(float p, float q, float t) {
    if (t < 0.0) t += 1.0;
    if (t > 1.0) t -= 1.0;
    if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
    if (t < 1.0/2.0) return q;
    if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
    return p;
  }
  vec3 hslToRgb(vec3 hsl) {
    if (hsl.y == 0.0) return vec3(hsl.z);
    float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
    float p = 2.0 * hsl.z - q;
    return vec3(
      hue2rgb(p, q, hsl.x + 1.0/3.0),
      hue2rgb(p, q, hsl.x),
      hue2rgb(p, q, hsl.x - 1.0/3.0)
    );
  }
  vec3 blend(vec3 src, vec3 dst) {
    vec3 srcHsl = rgbToHsl(src);
    vec3 dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3(dstHsl.x, dstHsl.y, srcHsl.z));
  }
`

const BLEND_FORMULAS: Partial<Record<BlendMode, string>> = {
  multiply: MULTIPLY_FORMULA,
  screen: SCREEN_FORMULA,
  overlay: OVERLAY_FORMULA,
  softLight: SOFT_LIGHT_FORMULA,
  add: ADD_FORMULA,
  color: COLOR_FORMULA,
  luminosity: LUMINOSITY_FORMULA,
}

/* ── WGSL shaders for WebGPU backend ── */

const WGSL_VERTEX = `
  struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
  };

  @vertex
  fn main(
    @location(0) aPosition: vec2<f32>,
    @location(1) aUV: vec2<f32>,
  ) -> VSOutput {
    var output: VSOutput;
    output.position = vec4<f32>(aPosition, 0.0, 1.0);
    output.uv = aUV;
    return output;
  }
`

function makeWgslBlendFragment(blendFn: string): string {
  return `
    @group(0) @binding(0) var uTexture: texture_2d<f32>;
    @group(0) @binding(1) var uSampler: sampler;
    @group(1) @binding(0) var uBackTexture: texture_2d<f32>;
    @group(1) @binding(1) var uBackSampler: sampler;

    struct BlendUniforms {
      uLayerOpacity: f32,
    };
    @group(2) @binding(0) var<uniform> uniforms: BlendUniforms;

    ${blendFn}

    @fragment
    fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
      let src = textureSample(uTexture, uSampler, uv);
      let dst = textureSample(uBackTexture, uBackSampler, uv);

      // Premultiplied -> straight alpha
      var srcRGB = src.rgb;
      if (src.a > 0.0) { srcRGB = src.rgb / src.a; }
      var dstRGB = dst.rgb;
      if (dst.a > 0.0) { dstRGB = dst.rgb / dst.a; }

      let blended = blend(srcRGB, dstRGB);
      let srcA = src.a * uniforms.uLayerOpacity;
      let resultRGB = mix(dstRGB, blended, srcA);
      let resultA = dst.a + srcA * (1.0 - dst.a);

      return vec4<f32>(resultRGB * resultA, resultA);
    }
  `
}

const WGSL_MULTIPLY = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return src * dst;
  }
`

const WGSL_SCREEN = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(1.0) - (vec3<f32>(1.0) - src) * (vec3<f32>(1.0) - dst);
  }
`

const WGSL_OVERLAY = `
  fn overlayChannel(s: f32, d: f32) -> f32 {
    if (d < 0.5) { return 2.0 * s * d; }
    return 1.0 - 2.0 * (1.0 - s) * (1.0 - d);
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      overlayChannel(src.r, dst.r),
      overlayChannel(src.g, dst.g),
      overlayChannel(src.b, dst.b),
    );
  }
`

const WGSL_SOFT_LIGHT = `
  fn softLightChannel(s: f32, d: f32) -> f32 {
    if (s <= 0.5) {
      return d - (1.0 - 2.0 * s) * d * (1.0 - d);
    }
    var g: f32;
    if (d <= 0.25) {
      g = ((16.0 * d - 12.0) * d + 4.0) * d;
    } else {
      g = sqrt(d);
    }
    return d + (2.0 * s - 1.0) * (g - d);
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      softLightChannel(src.r, dst.r),
      softLightChannel(src.g, dst.g),
      softLightChannel(src.b, dst.b),
    );
  }
`

const WGSL_ADD = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return min(src + dst, vec3<f32>(1.0));
  }
`

const WGSL_HSL_HELPERS = `
  fn rgbToHsl(c: vec3<f32>) -> vec3<f32> {
    let maxC = max(c.r, max(c.g, c.b));
    let minC = min(c.r, min(c.g, c.b));
    let l = (maxC + minC) / 2.0;
    var s: f32 = 0.0;
    var h: f32 = 0.0;
    if (maxC != minC) {
      let d = maxC - minC;
      if (l > 0.5) { s = d / (2.0 - maxC - minC); } else { s = d / (maxC + minC); }
      if (maxC == c.r) {
        h = (c.g - c.b) / d;
        if (c.g < c.b) { h = h + 6.0; }
      } else if (maxC == c.g) {
        h = (c.b - c.r) / d + 2.0;
      } else {
        h = (c.r - c.g) / d + 4.0;
      }
      h = h / 6.0;
    }
    return vec3<f32>(h, s, l);
  }
  fn hue2rgb(p: f32, q: f32, t_in: f32) -> f32 {
    var t = t_in;
    if (t < 0.0) { t = t + 1.0; }
    if (t > 1.0) { t = t - 1.0; }
    if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
    if (t < 0.5) { return q; }
    if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
    return p;
  }
  fn hslToRgb(hsl: vec3<f32>) -> vec3<f32> {
    if (hsl.y == 0.0) { return vec3<f32>(hsl.z); }
    var q: f32;
    if (hsl.z < 0.5) { q = hsl.z * (1.0 + hsl.y); } else { q = hsl.z + hsl.y - hsl.z * hsl.y; }
    let p = 2.0 * hsl.z - q;
    return vec3<f32>(
      hue2rgb(p, q, hsl.x + 1.0 / 3.0),
      hue2rgb(p, q, hsl.x),
      hue2rgb(p, q, hsl.x - 1.0 / 3.0),
    );
  }
`

const WGSL_COLOR = `
  ${WGSL_HSL_HELPERS}
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    let srcHsl = rgbToHsl(src);
    let dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3<f32>(srcHsl.x, srcHsl.y, dstHsl.z));
  }
`

const WGSL_LUMINOSITY = `
  ${WGSL_HSL_HELPERS}
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    let srcHsl = rgbToHsl(src);
    let dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3<f32>(dstHsl.x, dstHsl.y, srcHsl.z));
  }
`

const WGSL_BLEND_FORMULAS: Partial<Record<BlendMode, string>> = {
  multiply: WGSL_MULTIPLY,
  screen: WGSL_SCREEN,
  overlay: WGSL_OVERLAY,
  softLight: WGSL_SOFT_LIGHT,
  add: WGSL_ADD,
  color: WGSL_COLOR,
  luminosity: WGSL_LUMINOSITY,
}

/** Create a PixiJS Filter for a given custom blend mode (GLSL + WGSL). */
export function createBlendFilter(mode: BlendMode, layerOpacity: number = 1): Filter | null {
  const glFormula = BLEND_FORMULAS[mode]
  if (!glFormula) return null // 'normal' uses built-in blending

  const glProgram = GlProgram.from({
    vertex: VERTEX,
    fragment: makeBlendFragment(glFormula),
  })

  // Build WGSL program for WebGPU backends
  const wgslFormula = WGSL_BLEND_FORMULAS[mode]
  let gpuProgram: GpuProgram | undefined
  if (wgslFormula) {
    try {
      gpuProgram = GpuProgram.from({
        vertex: { source: WGSL_VERTEX, entryPoint: 'main' },
        fragment: { source: makeWgslBlendFragment(wgslFormula), entryPoint: 'main' },
      })
    } catch {
      // WebGPU shader compilation may fail on some platforms — fall back to GL only
    }
  }

  return new Filter({
    glProgram,
    gpuProgram,
    resources: {
      blendUniforms: {
        uLayerOpacity: { value: layerOpacity, type: 'f32' },
        uBackTexture: { value: null, type: 'f32' }, // will be set at render time
      },
    },
  })
}

/** Check if a blend mode needs a custom shader (vs built-in PixiJS alpha blend). */
export function needsCustomBlend(mode: BlendMode): boolean {
  return mode !== 'normal'
}
