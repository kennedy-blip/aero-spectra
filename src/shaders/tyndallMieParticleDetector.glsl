#version 300 es
precision highp float;
uniform sampler2D u_currentFrame;
uniform sampler2D u_previousFrame;
uniform vec2 u_resolution;
uniform float u_threshold;
uniform float u_gain;
uniform float u_time;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec3 now = texture(u_currentFrame, v_uv).rgb;
  vec3 before = texture(u_previousFrame, v_uv).rgb;
  float lumaNow = dot(now, vec3(0.2126, 0.7152, 0.0722));
  float lumaBefore = dot(before, vec3(0.2126, 0.7152, 0.0722));
  float motion = abs(lumaNow - lumaBefore);
  float sparkle = smoothstep(u_threshold, u_threshold + 0.08, motion) * min(1.0, motion * u_gain);
  float staticScatter = smoothstep(0.25, 0.85, lumaNow) * 0.025;
  vec3 darkField = vec3(0.012, 0.021, 0.038);
  vec3 particle = mix(vec3(0.17, 0.79, 0.94), vec3(1.0, 0.57, 0.20), smoothstep(0.08, 0.34, motion));
  float scan = 0.92 + 0.08 * sin(gl_FragCoord.y * 0.18 + u_time * 2.0);
  outColor = vec4(darkField + particle * (sparkle + staticScatter) * scan, 1.0);
}
