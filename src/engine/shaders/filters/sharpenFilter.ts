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

// Note: Custom WGSL shaders removed — PixiJS v8's WebGPU pipeline vertex buffer
// layout is incompatible with custom vertex shaders. Filters use GlProgram only.

/**
 * Create a sharpen (unsharp mask) filter.
 * Requires a pre-blurred texture to be set as uBlurTexture.
 */
export function createSharpenFilter(amount: number, threshold: number): Filter {
  const glProgram = GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT })

  return new Filter({
    glProgram,
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
