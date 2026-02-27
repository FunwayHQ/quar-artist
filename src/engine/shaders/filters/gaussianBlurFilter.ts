import { Filter, GlProgram } from 'pixi.js'

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

// Note: Custom WGSL vertex/fragment shaders removed — PixiJS v8's WebGPU pipeline
// expects specific vertex buffer layout attributes that custom shaders don't provide.
// Filters use GlProgram only; PixiJS handles WebGL rendering correctly on all backends.

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

    return new Filter({
      glProgram,
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
