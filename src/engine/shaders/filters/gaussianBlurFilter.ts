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

const FRAGMENT = `
  in vec2 vTextureCoord;
  out vec4 finalColor;

  uniform sampler2D uTexture;
  uniform vec2 uDirection;
  uniform float uRadius;
  uniform vec2 uResolution;

  void main(void) {
    if (uRadius < 0.5) {
      finalColor = texture(uTexture, vTextureCoord);
      return;
    }

    float sigma = max(uRadius / 3.0, 0.001);
    int samples = int(ceil(uRadius));
    // Cap sample count for performance
    if (samples > 64) samples = 64;

    float totalWeight = 0.0;
    vec4 color = vec4(0.0);
    vec2 texelSize = 1.0 / uResolution;
    vec2 step = uDirection * texelSize;

    for (int i = -samples; i <= samples; i++) {
      float fi = float(i);
      float weight = exp(-(fi * fi) / (2.0 * sigma * sigma));
      vec2 offset = step * fi;
      color += texture(uTexture, vTextureCoord + offset) * weight;
      totalWeight += weight;
    }

    finalColor = color / totalWeight;
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

  struct BlurUniforms {
    uDirection: vec2<f32>,
    uRadius: f32,
    uResolution: vec2<f32>,
  };
  @group(1) @binding(0) var<uniform> uniforms: BlurUniforms;

  @fragment
  fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    if (uniforms.uRadius < 0.5) {
      return textureSample(uTexture, uSampler, uv);
    }

    let sigma = max(uniforms.uRadius / 3.0, 0.001);
    let samples = i32(ceil(uniforms.uRadius));
    let clampedSamples = min(samples, 64);

    var totalWeight: f32 = 0.0;
    var color = vec4<f32>(0.0);
    let texelSize = vec2<f32>(1.0) / uniforms.uResolution;
    let step = uniforms.uDirection * texelSize;

    for (var i = -clampedSamples; i <= clampedSamples; i = i + 1) {
      let fi = f32(i);
      let weight = exp(-(fi * fi) / (2.0 * sigma * sigma));
      let offset = step * fi;
      color = color + textureSample(uTexture, uSampler, uv + offset) * weight;
      totalWeight = totalWeight + weight;
    }

    return color / totalWeight;
  }
`

/**
 * Create a separable 2-pass Gaussian blur filter pair.
 * Returns [horizontalFilter, verticalFilter].
 */
export function createGaussianBlurFilters(
  radius: number,
  width: number,
  height: number,
): Filter[] {
  const makeFilter = (dirX: number, dirY: number): Filter => {
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
        blurUniforms: {
          uDirection: { value: new Float32Array([dirX, dirY]), type: 'vec2<f32>' },
          uRadius: { value: radius, type: 'f32' },
          uResolution: { value: new Float32Array([width, height]), type: 'vec2<f32>' },
        },
      },
    })
  }

  return [makeFilter(1, 0), makeFilter(0, 1)]
}

/** Update an existing blur filter's radius and resolution uniforms. */
export function updateGaussianBlurUniforms(
  filters: Filter[],
  radius: number,
  width: number,
  height: number,
): void {
  for (const filter of filters) {
    const res = filter.resources.blurUniforms as any
    if (!res) continue
    const u = res.uniforms ?? res
    if (u.uRadius) u.uRadius.value = radius
    if (u.uResolution) {
      u.uResolution.value[0] = width
      u.uResolution.value[1] = height
    }
  }
}
