// Sphere-traced metaballs, one fragment shader, no library and no meshes.
//
// The story is the same one the CSS version told — three things becoming one —
// but a polynomial smooth-min union does what overlapping flat circles cannot:
// as two spheres approach, the surface between them stretches into a bridge and
// they fuse. That moment IS the milestone landing, so the visual says what the
// work is doing rather than decorating it.
//
// Everything is evaluated per pixel against a distance field. There is no
// geometry to upload, which is why this costs nothing in the bundle.

export const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;
uniform float uTime;
uniform vec3  uPos[3];    // sphere centres, already interpolated on the CPU
uniform vec3  uCol[3];    // one hue each, blended where they overlap
uniform vec3  uAnchor[3]; // where each hue is anchored in space — see albedo()
uniform float uFinish;    // 0..1, the settle after the last milestone

// Sized so the widest arrangement still clears the frustum: the spheres sit at
// 0.60 from centre with radius 0.44, and the camera below sees ~1.17 world
// units at that depth. Getting this wrong clips the silhouette against the
// canvas, which reads as a rendering fault rather than a design.
// Radius and spread are one decision, not two: three spheres read as separate
// only while the gap between them exceeds the blend width. At rest the centres
// sit 1.32 apart with radii summing to 0.92, leaving 0.40 of clear space
// against a K of 0.26 — enough that nothing bridges until a milestone actually
// moves one.
const float R    = 0.46;  // sphere radius
const float K    = 0.26;  // smooth-min blend width — the size of the bridge
// Sphere tracing converges quickly against a field this smooth — three
// spheres, no thin features — so the extra steps bought nothing visible and
// are pure cost on a weak GPU. Verified side by side at 72 and 56.
const int   STEPS = 56;
const float EPS  = 0.0012;
const float FAR  = 7.0;

// Polynomial smooth minimum. The k term is what rounds the join between two
// surfaces instead of creasing it, which is the whole effect.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  float d = length(p - uPos[0]) - R;
  d = smin(d, length(p - uPos[1]) - R, K);
  d = smin(d, length(p - uPos[2]) - R, K);
  return d;
}

// Hue as a function of WHERE ON THE SURFACE a point is, weighted toward three
// fixed anchors in space rather than toward the moving sphere centres.
//
// Weighting by the centres is the obvious thing and it fails at exactly the
// moment that matters: once all three have converged the distances are equal,
// every weight is equal, and the finished blob averages out to a desaturated
// grey — the payoff state, and the dullest thing on screen. Anchors stay put,
// so the merged sphere keeps a three-way gradient running across it and the
// palette reads the same from the first frame to the last.
vec3 albedo(vec3 p) {
  float w0 = 1.0 / (0.16 + dot(p - uAnchor[0], p - uAnchor[0]));
  float w1 = 1.0 / (0.16 + dot(p - uAnchor[1], p - uAnchor[1]));
  float w2 = 1.0 / (0.16 + dot(p - uAnchor[2], p - uAnchor[2]));
  return (uCol[0] * w0 + uCol[1] * w1 + uCol[2] * w2) / (w0 + w1 + w2);
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(EPS, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  vec3 ro = vec3(0.0, 0.0, 3.15);
  vec3 rd = normalize(vec3(uv, -1.25));

  float t = 0.0;
  float hit = -1.0;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < EPS) { hit = t; break; }
    t += d;
    if (t > FAR) break;
  }

  if (hit < 0.0) { outColor = vec4(0.0); return; }

  vec3 p = ro + rd * hit;
  vec3 n = normalAt(p);
  vec3 base = albedo(p);

  vec3 key = normalize(vec3(0.55, 0.75, 0.62));
  vec3 fill = normalize(vec3(-0.7, -0.2, 0.45));

  float diff  = max(dot(n, key), 0.0);
  float fillD = max(dot(n, fill), 0.0) * 0.25;
  float spec  = pow(max(dot(reflect(-key, n), -rd), 0.0), 46.0);
  // Fresnel: the surface turning away from the camera catches light along its
  // silhouette, which is most of what makes a raymarched blob read as solid.
  float rim   = pow(1.0 - max(dot(n, -rd), 0.0), 2.6);

  // Ambient kept low and diffuse high: the palette is already light, and
  // lifting the shadow side is what turned it pastel.
  vec3 col = base * (0.20 + 1.05 * diff + fillD);
  col += vec3(1.0) * spec * 0.55;
  col += base * rim * 0.80;
  // One quiet bloom of extra light when the work is done, so completion has a
  // beat of its own rather than simply stopping.
  col += base * uFinish * 0.30;

  // Opaque where the ray hit. An earlier version faded alpha by how deeply the
  // ray had entered the surface, which sounds like an edge-softener and is not:
  // that depth maxes out around 0.012 for a sphere this size, so a smoothstep
  // to 0.02 never reached 1 and the whole blob came out as a dim radial
  // gradient. The silhouette is smooth enough at 2x device pixels.
  outColor = vec4(col, 1.0);
}
`;
