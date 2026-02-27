import { Filter, GlProgram, GpuProgram } from 'pixi.js'
import { GLSL_HSL_HELPERS, WGSL_HSL_HELPERS } from '../common/hslHelpers.ts'

const VERTEX = `
  in vec2 aPosition;
  in vec2 aUV;
  out vec2 vTextureCoord;

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
  }
`

const FRAGMENT = `
  in vec2 vTextureCoord;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform float uHueShift;
  uniform float uSaturation;
  uniform float uBrightness;

  ${GLSL_HSL_HELPERS}

  void main(void) {
    vec4 color = texture(uTexture, vTextureCoord);
    if (color.a < 0.001) {
      finalColor = color;
      return;
    }

    // Unpremultiply
    vec3 rgb = color.rgb / color.a;

    vec3 hsl = rgbToHsl(rgb);

    // Hue shift: uHueShift is -180..+180, normalize to 0..1
    hsl.x = fract(hsl.x + uHueShift / 360.0);

    // Saturation: uSaturation is -100..+100, map to multiplier
    if (uSaturation > 0.0) {
      hsl.y = hsl.y + (1.0 - hsl.y) * (uSaturation / 100.0);
    } else {
      hsl.y = hsl.y * (1.0 + uSaturation / 100.0);
    }
    hsl.y = clamp(hsl.y, 0.0, 1.0);

    // Brightness: uBrightness is -100..+100, map to lightness offset
    if (uBrightness > 0.0) {
      hsl.z = hsl.z + (1.0 - hsl.z) * (uBrightness / 100.0);
    } else {
      hsl.z = hsl.z * (1.0 + uBrightness / 100.0);
    }
    hsl.z = clamp(hsl.z, 0.0, 1.0);

    rgb = hslToRgb(hsl);

    // Premultiply
    finalColor = vec4(rgb * color.a, color.a);
  }
`

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

const WGSL_FRAGMENT = `
  @group(0) @binding(0) var uTexture: texture_2d<f32>;
  @group(0) @binding(1) var uSampler: sampler;

  struct HSBUniforms {
    uHueShift: f32,
    uSaturation: f32,
    uBrightness: f32,
  };
  @group(1) @binding(0) var<uniform> uniforms: HSBUniforms;

  ${WGSL_HSL_HELPERS}

  @fragment
  fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let color = textureSample(uTexture, uSampler, uv);
    if (color.a < 0.001) {
      return color;
    }

    var rgb = color.rgb / color.a;
    var hsl = rgbToHsl(rgb);

    hsl.x = fract(hsl.x + uniforms.uHueShift / 360.0);

    if (uniforms.uSaturation > 0.0) {
      hsl.y = hsl.y + (1.0 - hsl.y) * (uniforms.uSaturation / 100.0);
    } else {
      hsl.y = hsl.y * (1.0 + uniforms.uSaturation / 100.0);
    }
    hsl.y = clamp(hsl.y, 0.0, 1.0);

    if (uniforms.uBrightness > 0.0) {
      hsl.z = hsl.z + (1.0 - hsl.z) * (uniforms.uBrightness / 100.0);
    } else {
      hsl.z = hsl.z * (1.0 + uniforms.uBrightness / 100.0);
    }
    hsl.z = clamp(hsl.z, 0.0, 1.0);

    rgb = hslToRgb(hsl);
    return vec4<f32>(rgb * color.a, color.a);
  }
`

export function createHSBAdjustmentFilter(
  hueShift: number,
  saturation: number,
  brightness: number,
): Filter {
  const glProgram = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT })

  let gpuProgram: GpuProgram | undefined
  try {
    gpuProgram = GpuProgram.from({
      vertex: { source: WGSL_VERTEX, entryPoint: 'main' },
      fragment: { source: WGSL_FRAGMENT, entryPoint: 'main' },
    })
  } catch {
    // Fall back to GL
  }

  return new Filter({
    glProgram,
    gpuProgram,
    resources: {
      hsbUniforms: {
        uHueShift: { value: hueShift, type: 'f32' },
        uSaturation: { value: saturation, type: 'f32' },
        uBrightness: { value: brightness, type: 'f32' },
      },
    },
  })
}

export function updateHSBUniforms(
  filter: Filter,
  hueShift: number,
  saturation: number,
  brightness: number,
): void {
  const res = filter.resources.hsbUniforms as any
  if (!res) return
  const u = res.uniforms ?? res
  if (u.uHueShift) u.uHueShift.value = hueShift
  if (u.uSaturation) u.uSaturation.value = saturation
  if (u.uBrightness) u.uBrightness.value = brightness
}
