import { Filter, GlProgram, GpuProgram } from 'pixi.js'

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

/**
 * Unsharp mask: output = original + amount * (original - blurred)
 * Gated by luminance threshold to avoid sharpening noise in smooth areas.
 */
const FRAGMENT = `
  in vec2 vTextureCoord;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform sampler2D uBlurTexture;
  uniform float uAmount;
  uniform float uThreshold;

  void main(void) {
    vec4 original = texture(uTexture, vTextureCoord);
    vec4 blurred = texture(uBlurTexture, vTextureCoord);

    vec4 diff = original - blurred;

    // Luminance-based threshold gating
    float lum = dot(abs(diff.rgb), vec3(0.299, 0.587, 0.114));
    float gate = smoothstep(uThreshold / 255.0, uThreshold / 255.0 + 0.01, lum);

    finalColor = original + diff * uAmount * gate;
    finalColor = clamp(finalColor, vec4(0.0), vec4(1.0));
    finalColor.a = original.a;
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
  @group(1) @binding(0) var uBlurTexture: texture_2d<f32>;
  @group(1) @binding(1) var uBlurSampler: sampler;

  struct SharpenUniforms {
    uAmount: f32,
    uThreshold: f32,
  };
  @group(2) @binding(0) var<uniform> uniforms: SharpenUniforms;

  @fragment
  fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    let original = textureSample(uTexture, uSampler, uv);
    let blurred = textureSample(uBlurTexture, uBlurSampler, uv);

    let diff = original - blurred;
    let lum = dot(abs(diff.rgb), vec3<f32>(0.299, 0.587, 0.114));
    let gate = smoothstep(uniforms.uThreshold / 255.0, uniforms.uThreshold / 255.0 + 0.01, lum);

    var result = original + diff * uniforms.uAmount * gate;
    result = clamp(result, vec4<f32>(0.0), vec4<f32>(1.0));
    result.a = original.a;
    return result;
  }
`

/**
 * Create a sharpen (unsharp mask) filter.
 * Requires a pre-blurred texture to be set as uBlurTexture.
 */
export function createSharpenFilter(amount: number, threshold: number): Filter {
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
      sharpenUniforms: {
        uAmount: { value: amount / 100, type: 'f32' },
        uThreshold: { value: threshold, type: 'f32' },
        uBlurTexture: { value: null, type: 'f32' },
      },
    },
  })
}

export function updateSharpenUniforms(filter: Filter, amount: number, threshold: number): void {
  const res = filter.resources.sharpenUniforms as any
  if (!res) return
  const u = res.uniforms ?? res
  if (u.uAmount) u.uAmount.value = amount / 100
  if (u.uThreshold) u.uThreshold.value = threshold
}
