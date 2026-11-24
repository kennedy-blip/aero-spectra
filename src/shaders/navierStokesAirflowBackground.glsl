#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_cfm;
uniform float u_aqi;
uniform int u_lightMode;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float value = 0.0, amplitude = 0.5;
  for (int i = 0; i < 4; i++) { value += noise(p) * amplitude; p *= 2.03; amplitude *= 0.5; }
  return value;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 p = (uv - 0.5) * vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float flow = clamp(u_cfm / 400.0, 0.1, 1.8);
  float time = u_time * (0.055 + flow * 0.12);
  float field = fbm(p * 2.4 + vec2(time, -time * 0.61));
  float warp = fbm(p * 1.7 + vec2(-time * 0.72, time * 0.8));
  float stream = abs(sin((p.y * 5.8 + (field - 0.5) * 3.6 + warp * 0.8) * 3.14159));
  float lines = smoothstep(0.955 - min(flow, 1.0) * 0.018, 1.0, stream);
  float dust = smoothstep(0.972, 1.0, noise(floor((uv + vec2(time * 0.006, time * 0.002)) * u_resolution * 0.14)));
  float smoke = smoothstep(55.0, 220.0, u_aqi);
  vec3 clean = vec3(0.11, 0.63, 0.78);
  vec3 alert = vec3(0.94, 0.38, 0.16);
  vec3 tint = mix(clean, alert, smoke * 0.84);
  float opacity = lines * 0.16 + dust * (0.12 + smoke * 0.12);
  vec3 base = u_lightMode == 1 ? vec3(0.91, 0.95, 0.98) : vec3(0.018, 0.035, 0.06);
  outColor = vec4(mix(base, tint, opacity), 1.0);
}
