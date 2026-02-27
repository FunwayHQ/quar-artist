import { Filter, GlProgram, GpuProgram } from 'pixi.js'
import type { BlendMode } from '../../../types/layer.ts'
import { GLSL_HSL_HELPERS, WGSL_HSL_HELPERS } from '../common/hslHelpers.ts'

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

// ── GLSL blend formulas ──────────────────────────────────────────────────

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
  ${GLSL_HSL_HELPERS}
  vec3 blend(vec3 src, vec3 dst) {
    vec3 srcHsl = rgbToHsl(src);
    vec3 dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3(srcHsl.x, srcHsl.y, dstHsl.z));
  }
`

const LUMINOSITY_FORMULA = `
  ${GLSL_HSL_HELPERS}
  vec3 blend(vec3 src, vec3 dst) {
    vec3 srcHsl = rgbToHsl(src);
    vec3 dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3(dstHsl.x, dstHsl.y, srcHsl.z));
  }
`

// ── New PixiJS-native blend formulas (Batch 1) ──

const DARKEN_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return min(src, dst);
  }
`

const LIGHTEN_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return max(src, dst);
  }
`

const COLOR_DODGE_FORMULA = `
  float colorDodgeChannel(float s, float d) {
    if (d == 0.0) return 0.0;
    if (s >= 1.0) return 1.0;
    return min(1.0, d / (1.0 - s));
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      colorDodgeChannel(src.r, dst.r),
      colorDodgeChannel(src.g, dst.g),
      colorDodgeChannel(src.b, dst.b)
    );
  }
`

const COLOR_BURN_FORMULA = `
  float colorBurnChannel(float s, float d) {
    if (d >= 1.0) return 1.0;
    if (s == 0.0) return 0.0;
    return 1.0 - min(1.0, (1.0 - d) / s);
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      colorBurnChannel(src.r, dst.r),
      colorBurnChannel(src.g, dst.g),
      colorBurnChannel(src.b, dst.b)
    );
  }
`

const HARD_LIGHT_FORMULA = `
  float hardLightChannel(float s, float d) {
    return s < 0.5 ? 2.0 * s * d : 1.0 - 2.0 * (1.0 - s) * (1.0 - d);
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      hardLightChannel(src.r, dst.r),
      hardLightChannel(src.g, dst.g),
      hardLightChannel(src.b, dst.b)
    );
  }
`

const DIFFERENCE_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return abs(src - dst);
  }
`

const EXCLUSION_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return src + dst - 2.0 * src * dst;
  }
`

const HUE_FORMULA = `
  ${GLSL_HSL_HELPERS}
  vec3 blend(vec3 src, vec3 dst) {
    vec3 srcHsl = rgbToHsl(src);
    vec3 dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3(srcHsl.x, dstHsl.y, dstHsl.z));
  }
`

const SATURATION_FORMULA = `
  ${GLSL_HSL_HELPERS}
  vec3 blend(vec3 src, vec3 dst) {
    vec3 srcHsl = rgbToHsl(src);
    vec3 dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3(dstHsl.x, srcHsl.y, dstHsl.z));
  }
`

// ── Custom shader blend formulas (Batch 2) ──

const VIVID_LIGHT_FORMULA = `
  float vividLightChannel(float s, float d) {
    if (s <= 0.5) {
      float s2 = 2.0 * s;
      if (s2 == 0.0) return 0.0;
      return 1.0 - min(1.0, (1.0 - d) / s2);
    } else {
      float s2 = 2.0 * (s - 0.5);
      if (s2 >= 1.0) return 1.0;
      return min(1.0, d / (1.0 - s2));
    }
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      vividLightChannel(src.r, dst.r),
      vividLightChannel(src.g, dst.g),
      vividLightChannel(src.b, dst.b)
    );
  }
`

const LINEAR_LIGHT_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return clamp(dst + 2.0 * src - vec3(1.0), vec3(0.0), vec3(1.0));
  }
`

const PIN_LIGHT_FORMULA = `
  float pinLightChannel(float s, float d) {
    if (s < 0.5) {
      return min(d, 2.0 * s);
    } else {
      return max(d, 2.0 * s - 1.0);
    }
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      pinLightChannel(src.r, dst.r),
      pinLightChannel(src.g, dst.g),
      pinLightChannel(src.b, dst.b)
    );
  }
`

const HARD_MIX_FORMULA = `
  float vividLightForHardMix(float s, float d) {
    if (s <= 0.5) {
      float s2 = 2.0 * s;
      if (s2 == 0.0) return 0.0;
      return 1.0 - min(1.0, (1.0 - d) / s2);
    } else {
      float s2 = 2.0 * (s - 0.5);
      if (s2 >= 1.0) return 1.0;
      return min(1.0, d / (1.0 - s2));
    }
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      vividLightForHardMix(src.r, dst.r) >= 0.5 ? 1.0 : 0.0,
      vividLightForHardMix(src.g, dst.g) >= 0.5 ? 1.0 : 0.0,
      vividLightForHardMix(src.b, dst.b) >= 0.5 ? 1.0 : 0.0
    );
  }
`

const SUBTRACT_FORMULA = `
  vec3 blend(vec3 src, vec3 dst) {
    return max(dst - src, vec3(0.0));
  }
`

const DIVIDE_FORMULA = `
  float divideChannel(float s, float d) {
    if (s == 0.0) return 1.0;
    return min(1.0, d / s);
  }
  vec3 blend(vec3 src, vec3 dst) {
    return vec3(
      divideChannel(src.r, dst.r),
      divideChannel(src.g, dst.g),
      divideChannel(src.b, dst.b)
    );
  }
`

const DARKER_COLOR_FORMULA = `
  float luminance(vec3 c) {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  }
  vec3 blend(vec3 src, vec3 dst) {
    return luminance(src) < luminance(dst) ? src : dst;
  }
`

const LIGHTER_COLOR_FORMULA = `
  float luminance(vec3 c) {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  }
  vec3 blend(vec3 src, vec3 dst) {
    return luminance(src) > luminance(dst) ? src : dst;
  }
`

const DISSOLVE_FORMULA = `
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  vec3 blend(vec3 src, vec3 dst) {
    return src;
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
  // Batch 1 — PixiJS-native (formulas used for custom filter fallback path)
  darken: DARKEN_FORMULA,
  lighten: LIGHTEN_FORMULA,
  colorDodge: COLOR_DODGE_FORMULA,
  colorBurn: COLOR_BURN_FORMULA,
  hardLight: HARD_LIGHT_FORMULA,
  difference: DIFFERENCE_FORMULA,
  exclusion: EXCLUSION_FORMULA,
  hue: HUE_FORMULA,
  saturation: SATURATION_FORMULA,
  // Batch 2 — Custom shader modes
  vividLight: VIVID_LIGHT_FORMULA,
  linearLight: LINEAR_LIGHT_FORMULA,
  pinLight: PIN_LIGHT_FORMULA,
  hardMix: HARD_MIX_FORMULA,
  subtract: SUBTRACT_FORMULA,
  divide: DIVIDE_FORMULA,
  darkerColor: DARKER_COLOR_FORMULA,
  lighterColor: LIGHTER_COLOR_FORMULA,
  dissolve: DISSOLVE_FORMULA,
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

// ── New WGSL formulas (Batch 1 — PixiJS-native) ──

const WGSL_DARKEN = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return min(src, dst);
  }
`

const WGSL_LIGHTEN = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return max(src, dst);
  }
`

const WGSL_COLOR_DODGE = `
  fn colorDodgeChannel(s: f32, d: f32) -> f32 {
    if (d == 0.0) { return 0.0; }
    if (s >= 1.0) { return 1.0; }
    return min(1.0, d / (1.0 - s));
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      colorDodgeChannel(src.r, dst.r),
      colorDodgeChannel(src.g, dst.g),
      colorDodgeChannel(src.b, dst.b),
    );
  }
`

const WGSL_COLOR_BURN = `
  fn colorBurnChannel(s: f32, d: f32) -> f32 {
    if (d >= 1.0) { return 1.0; }
    if (s == 0.0) { return 0.0; }
    return 1.0 - min(1.0, (1.0 - d) / s);
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      colorBurnChannel(src.r, dst.r),
      colorBurnChannel(src.g, dst.g),
      colorBurnChannel(src.b, dst.b),
    );
  }
`

const WGSL_HARD_LIGHT = `
  fn hardLightChannel(s: f32, d: f32) -> f32 {
    if (s < 0.5) { return 2.0 * s * d; }
    return 1.0 - 2.0 * (1.0 - s) * (1.0 - d);
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      hardLightChannel(src.r, dst.r),
      hardLightChannel(src.g, dst.g),
      hardLightChannel(src.b, dst.b),
    );
  }
`

const WGSL_DIFFERENCE = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return abs(src - dst);
  }
`

const WGSL_EXCLUSION = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return src + dst - 2.0 * src * dst;
  }
`

const WGSL_HUE = `
  ${WGSL_HSL_HELPERS}
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    let srcHsl = rgbToHsl(src);
    let dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3<f32>(srcHsl.x, dstHsl.y, dstHsl.z));
  }
`

const WGSL_SATURATION = `
  ${WGSL_HSL_HELPERS}
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    let srcHsl = rgbToHsl(src);
    let dstHsl = rgbToHsl(dst);
    return hslToRgb(vec3<f32>(dstHsl.x, srcHsl.y, dstHsl.z));
  }
`

// ── New WGSL formulas (Batch 2 — Custom shader) ──

const WGSL_VIVID_LIGHT = `
  fn vividLightChannel(s: f32, d: f32) -> f32 {
    if (s <= 0.5) {
      let s2 = 2.0 * s;
      if (s2 == 0.0) { return 0.0; }
      return 1.0 - min(1.0, (1.0 - d) / s2);
    } else {
      let s2 = 2.0 * (s - 0.5);
      if (s2 >= 1.0) { return 1.0; }
      return min(1.0, d / (1.0 - s2));
    }
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      vividLightChannel(src.r, dst.r),
      vividLightChannel(src.g, dst.g),
      vividLightChannel(src.b, dst.b),
    );
  }
`

const WGSL_LINEAR_LIGHT = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return clamp(dst + 2.0 * src - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
  }
`

const WGSL_PIN_LIGHT = `
  fn pinLightChannel(s: f32, d: f32) -> f32 {
    if (s < 0.5) {
      return min(d, 2.0 * s);
    } else {
      return max(d, 2.0 * s - 1.0);
    }
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      pinLightChannel(src.r, dst.r),
      pinLightChannel(src.g, dst.g),
      pinLightChannel(src.b, dst.b),
    );
  }
`

const WGSL_HARD_MIX = `
  fn vividLightForHardMix(s: f32, d: f32) -> f32 {
    if (s <= 0.5) {
      let s2 = 2.0 * s;
      if (s2 == 0.0) { return 0.0; }
      return 1.0 - min(1.0, (1.0 - d) / s2);
    } else {
      let s2 = 2.0 * (s - 0.5);
      if (s2 >= 1.0) { return 1.0; }
      return min(1.0, d / (1.0 - s2));
    }
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    var r: f32 = 0.0;
    var g: f32 = 0.0;
    var b: f32 = 0.0;
    if (vividLightForHardMix(src.r, dst.r) >= 0.5) { r = 1.0; }
    if (vividLightForHardMix(src.g, dst.g) >= 0.5) { g = 1.0; }
    if (vividLightForHardMix(src.b, dst.b) >= 0.5) { b = 1.0; }
    return vec3<f32>(r, g, b);
  }
`

const WGSL_SUBTRACT = `
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return max(dst - src, vec3<f32>(0.0));
  }
`

const WGSL_DIVIDE = `
  fn divideChannel(s: f32, d: f32) -> f32 {
    if (s == 0.0) { return 1.0; }
    return min(1.0, d / s);
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
      divideChannel(src.r, dst.r),
      divideChannel(src.g, dst.g),
      divideChannel(src.b, dst.b),
    );
  }
`

const WGSL_DARKER_COLOR = `
  fn luminance(c: vec3<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    if (luminance(src) < luminance(dst)) { return src; }
    return dst;
  }
`

const WGSL_LIGHTER_COLOR = `
  fn luminance(c: vec3<f32>) -> f32 {
    return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    if (luminance(src) > luminance(dst)) { return src; }
    return dst;
  }
`

const WGSL_DISSOLVE = `
  fn hash(p: vec2<f32>) -> f32 {
    return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453123);
  }
  fn blend(src: vec3<f32>, dst: vec3<f32>) -> vec3<f32> {
    return src;
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
  // Batch 1
  darken: WGSL_DARKEN,
  lighten: WGSL_LIGHTEN,
  colorDodge: WGSL_COLOR_DODGE,
  colorBurn: WGSL_COLOR_BURN,
  hardLight: WGSL_HARD_LIGHT,
  difference: WGSL_DIFFERENCE,
  exclusion: WGSL_EXCLUSION,
  hue: WGSL_HUE,
  saturation: WGSL_SATURATION,
  // Batch 2
  vividLight: WGSL_VIVID_LIGHT,
  linearLight: WGSL_LINEAR_LIGHT,
  pinLight: WGSL_PIN_LIGHT,
  hardMix: WGSL_HARD_MIX,
  subtract: WGSL_SUBTRACT,
  divide: WGSL_DIVIDE,
  darkerColor: WGSL_DARKER_COLOR,
  lighterColor: WGSL_LIGHTER_COLOR,
  dissolve: WGSL_DISSOLVE,
}

/**
 * Blend modes that require the custom filter pipeline (not PixiJS built-in).
 * These modes map to 'normal' in PIXI_BLEND_MAP and the compositor
 * must use createBlendFilter() + a background texture uniform instead.
 */
export const CUSTOM_BLEND_MODES: Set<BlendMode> = new Set([
  'vividLight',
  'linearLight',
  'pinLight',
  'hardMix',
  'subtract',
  'divide',
  'darkerColor',
  'lighterColor',
  'dissolve',
])

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
