/**
 * Shared HSL conversion functions for GLSL and WGSL shaders.
 * Used by blend filters (color, luminosity) and HSB adjustment filter.
 */

export const GLSL_HSL_HELPERS = `
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
`

export const WGSL_HSL_HELPERS = `
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
