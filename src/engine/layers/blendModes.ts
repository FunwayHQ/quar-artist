/**
 * PixiJS blend modes for the compositor. Import this module for its side
 * effects before anything renders with a blend mode.
 *
 * - Registers PixiJS's advanced blend modes. Without them PixiJS draws every
 *   mode except normal, multiply, screen and add as Normal (F15).
 * - Replaces PixiJS's Soft Light, whose WebGPU shader has the two halves of
 *   the formula swapped (F104).
 *
 * The shader compositor (plan M2.4) replaces both.
 */
import 'pixi.js/advanced-blend-modes'
import { BlendModeFilter, ExtensionType, extensions } from 'pixi.js'

/**
 * PixiJS 8's SoftLightBlend, with the WGSL fixed. WGSL's `select(f, t, cond)`
 * returns `t` when `cond` is true, the reverse of GLSL's `cond ? t : f`, and
 * PixiJS ported the GLSL expression without swapping the arguments.
 */
class SoftLightBlend extends BlendModeFilter {
  static extension = { name: 'soft-light', type: ExtensionType.BlendMode } as const

  constructor() {
    super({
      gl: {
        functions: `
          float softLight(float base, float blend)
          {
              return (blend < 0.5)
                  ? (2.0 * base * blend + base * base * (1.0 - 2.0 * blend))
                  : (sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend));
          }

          vec3 blendSoftLight(vec3 base, vec3 blend, float opacity)
          {
              vec3 blended = vec3(
                  softLight(base.r, blend.r),
                  softLight(base.g, blend.g),
                  softLight(base.b, blend.b)
              );
              return (blended * opacity + base * (1.0 - opacity));
          }
        `,
        main: `
          finalColor = vec4(blendSoftLight(back.rgb, front.rgb, front.a), blendedAlpha) * uBlend;
        `,
      },
      gpu: {
        functions: `
          fn softLight(base: f32, blend: f32) -> f32
          {
              return select(
                  sqrt(base) * (2.0 * blend - 1.0) + 2.0 * base * (1.0 - blend),
                  2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
                  blend < 0.5
              );
          }

          fn blendSoftLight(base: vec3<f32>, blend: vec3<f32>, opacity: f32) -> vec3<f32>
          {
              let blended: vec3<f32> = vec3<f32>(
                  softLight(base.r, blend.r),
                  softLight(base.g, blend.g),
                  softLight(base.b, blend.b)
              );
              return (blended * opacity + base * (1.0 - opacity));
          }
        `,
        main: `
          out = vec4<f32>(blendSoftLight(back.rgb, front.rgb, front.a), blendedAlpha) * blendUniforms.uBlend;
        `,
      },
    })
  }
}

// Registered after PixiJS's own, so it takes the 'soft-light' name.
extensions.add(SoftLightBlend)
