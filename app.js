// three r160 + addons, bundled locally (vendor/three-kit.js) so the page never waits on a third-party CDN
import { THREE, OrbitControls, mergeGeometries, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass, GLTFLoader, MeshoptDecoder } from './vendor/three-kit.js';
import { PETS, buildRing } from './pets.js';
import { createBook } from './book.js';
// phones & low-memory devices: lighter reef, fewer fish, no MSAA, smaller shadow map, music after entry
const LOW = new URLSearchParams(location.search).has('low') || window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600 || (navigator.deviceMemory && navigator.deviceMemory <= 4);


/* =====================================================================
   Loading screen: fetch models + music with progress, enter when ready
   ===================================================================== */
const ldBar = document.getElementById('ldBar'), ldPct = document.getElementById('ldPct'), ldTxt = document.getElementById('ldTxt'), loaderEl = document.getElementById('loader');
let ldShown = 0;
function setLoad(p, txt){ ldShown = Math.max(ldShown, Math.min(100, p)); ldBar.style.transform = `scaleX(${ldShown / 100})`; ldPct.textContent = Math.round(ldShown) + '%'; if (txt) ldTxt.textContent = txt; }
const tick = (p, txt) => { setLoad(p, txt); return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };
setLoad(3, '正在潜入深海……');
async function fetchAll(list){
  const got = list.map(() => 0), tot = list.map(it => it.size);
  const upd = () => { const a = got.reduce((x, v) => x + v, 0), b = tot.reduce((x, v) => x + v, 0); setLoad(5 + 55 * Math.min(1, a / b), '正在唤醒深海……'); };
  return Promise.all(list.map(async (it, i) => {
    const res = await fetch(it.url); if (!res.ok) throw new Error(it.url + ' ' + res.status);
    const contentSize = Number(res.headers.get('content-length')); if (contentSize > 0) tot[i] = contentSize;
    if (!res.body || !res.body.getReader){ const b = await res.arrayBuffer(); got[i] = tot[i]; upd(); return b; }
    const reader = res.body.getReader(), chunks = [];
    for (;;){ const { done, value } = await reader.read(); if (done) break; chunks.push(value); got[i] = Math.min(tot[i], got[i] + value.length); upd(); }
    got[i] = tot[i]; upd();
    let n = 0; for (const c of chunks) n += c.length; const buf = new Uint8Array(n); let o = 0; for (const c of chunks){ buf.set(c, o); o += c.length; }
    return buf.buffer;
  }));
}
window.addEventListener('error', () => { if (!window.__sceneReady && ldTxt) ldTxt.textContent = '加载遇到问题，请刷新页面重试'; });
const AC = new (window.AudioContext || window.webkitAudioContext)();
let gShell, gTree, bgmBuf = null, bgmLoopEnd = 0, bgmFetch = Promise.resolve(null);
const T3 = {};   // Tripo-generated models (statue, shell, boat, mermaid hologram, five pets)
const TRIPO = ['poseidon', 'shell', 'boat', 'mermaid', 'pet0', 'pet1', 'pet2', 'pet3', 'pet4'];
const loadImg = src => new Promise((ok, bad) => { const im = new Image(); im.decoding = 'async'; im.onload = () => ok(im); im.onerror = bad; im.src = src; });
try {
  const MD = LOW ? 'models/low/' : 'models/', SZ = LOW ? { shell: 109976, tree: 141420 } : { shell: 354304, tree: 600020 };
  const TSZ = LOW ? { poseidon: 504692, shell: 236400, boat: 219844, mermaid: 247524, pet0: 121504, pet1: 130792, pet2: 132168, pet3: 125200, pet4: 145068 }
                  : { poseidon: 1068644, shell: 421472, boat: 394364, mermaid: 459144, pet0: 212388, pet1: 230764, pet2: 239780, pet3: 224700, pet4: 266308 };
  const bufs = await fetchAll([{ url: MD + 'shell.glb', size: SZ.shell }, { url: MD + 'tree.glb', size: SZ.tree }, ...TRIPO.map(n => ({ url: MD + 'tripo/' + n + '.glb', size: TSZ[n] }))]);
  await tick(62, '正在雕琢圣像与人鱼……');
  const gl = new GLTFLoader(); gl.setMeshoptDecoder(MeshoptDecoder);
  const parsed = await Promise.all(bufs.map(b => gl.parseAsync(b, '')));
  [gShell, gTree] = parsed; TRIPO.forEach((n, i) => { T3[n] = parsed[i + 2]; });
} catch (e) {
  ldTxt.textContent = '加载失败，请刷新页面重试'; throw e;
}
await tick(68, '正在构筑圣城……');

/* =====================================================================
   0. Utilities
   ===================================================================== */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261008);
const R = (a, b) => a + (b - a) * rand();
const pick = arr => arr[Math.floor(rand() * arr.length)];
function hash2(ix, iy){ let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y){
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
function fbm(x, y, o = 5){ let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++){ s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
function ridge(x, y, o = 3){ let s = 0, a = 0.5, f = 1; for (let i = 0; i < o; i++){ s += a * (1 - Math.abs(vnoise(x * f + 17.3, y * f - 9.1))); f *= 2.1; a *= 0.5; } return s; }
const normA = a => ((a % TAU) + TAU) % TAU;
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* =====================================================================
   1. Renderer / scene / camera
   ===================================================================== */
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LOW, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.25 : 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x2a8fae, 150, 950);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.3, 4200);
const HOME = { pos: new THREE.Vector3(0, 194, 294), target: new THREE.Vector3(0, 3, 16) };
camera.position.copy(HOME.pos);

/* shared animated uniforms (injected into standard materials) */
const U = {
  uTime: { value: 0 }, uCaustic: { value: 1 }, uCausticColor: { value: new THREE.Color(1, 1, 1) },
  uSunDir: { value: new THREE.Vector3(0.4, 1, 0.5).normalize() }, uSway: { value: 1 },
  uCurrent: { value: new THREE.Vector2(0.6, 0.2) }, uWaterGlow: { value: 0.5 }
};

const CAUSTIC_GLSL = /* glsl */`
uniform float uTime; uniform float uCaustic; uniform vec3 uCausticColor; uniform vec3 uSunDir; uniform float uWaterGlow;
varying vec3 vCW;
float causticP(vec2 p){
  float t = uTime * 0.32 + 23.0;
  vec2 q = mod(p * 6.28318, 6.28318) - 250.0;
  vec2 i = q; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++){
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    float sx = sin(i.x + tt), cy = cos(i.y + tt);
    sx = sx >= 0.0 ? max(sx, 1e-3) : min(sx, -1e-3); cy = cy >= 0.0 ? max(cy, 1e-3) : min(cy, -1e-3);
    c += 1.0 / max(length(vec2(q.x / (sx / inten), q.y / (cy / inten))), 1e-3);
  }
  c = clamp(c / 4.0, 0.0, 8.0); c = clamp(1.17 - pow(c, 1.4), -1.5, 1.5);
  return clamp(pow(abs(c), 8.0), 0.0, 1.6);
}
vec2 causticUV(vec3 w){ return (w.xz - uSunDir.xz / max(uSunDir.y, 0.25) * w.y) / 10.5; }
`;
const SWAY_GLSL = /* glsl */`
uniform float uTime; uniform float uSway; uniform vec2 uCurrent; uniform float uSwayAmt;
vec3 swayIt(vec3 p, float amt){
  float hk = clamp(p.y, 0.0, 1.2); hk *= hk;
  vec2 ip = vec2(0.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xz;
  #endif
  float ph = ip.x * 0.37 + ip.y * 0.29;
  p.x += (sin(uTime * 1.05 + ph + p.y * 1.8) * 0.16 * uSway + uCurrent.x * 0.22) * hk * amt;
  p.z += (cos(uTime * 0.86 + ph * 1.3 + p.y * 1.5) * 0.14 * uSway + uCurrent.y * 0.22) * hk * amt;
  return p;
}
`;
/** Patch a MeshStandardMaterial: underwater caustics on lit surfaces, optional sway / fish wiggle / water ripple. */
function patch(mat, { caustic = true, sway = 0, fish = false, water = false, boost = 0 } = {}){
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    // per-material amounts live in uniforms (not baked constants) so materials share one compiled program
    sh.uniforms.uSwayAmt = { value: sway }; sh.uniforms.uBoost = { value: boost };
    let vtx = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;\n' + (sway || fish ? SWAY_GLSL : ''));
    let begin = '#include <begin_vertex>\n';
    if (sway) begin += `transformed = swayIt(transformed, uSwayAmt);\n`;
    if (fish) begin += `{ float ph = float(gl_InstanceID) * 1.731; float k = smoothstep(0.25, -0.55, position.x); transformed.z += sin(uTime * 9.0 + ph + position.x * 5.0) * 0.16 * k; }\n`;
    vtx = vtx.replace('#include <begin_vertex>', begin);
    vtx = vtx.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 cwp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        cwp = instanceMatrix * cwp;
      #endif
      vCW = (modelMatrix * cwp).xyz;`);
    sh.vertexShader = vtx;
    let frg = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + CAUSTIC_GLSL + (boost ? 'uniform float uBoost;\n' : ''));
    if (water){
      frg = frg.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 wp = vCW.xz;
          float gx = cos(wp.x * 0.9 + uTime * 1.3) * 0.5 + cos((wp.x + wp.y) * 1.4 - uTime * 1.7) * 0.35 + cos(wp.x * 2.7 - uTime * 2.3) * 0.15;
          float gz = sin(wp.y * 0.8 - uTime * 1.1) * 0.5 + sin((wp.y - wp.x) * 1.3 + uTime * 1.5) * 0.35 + sin(wp.y * 2.9 + uTime * 2.1) * 0.15;
          normal = normalize(normal + (viewMatrix * vec4(gx * 0.09, 0.0, gz * 0.09, 0.0)).xyz);
        }`);
      frg = frg.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(0.45, 0.95, 1.0) * causticP(vCW.xz / 7.0) * 0.18 * uWaterGlow;`);
    }
    if (caustic){
      frg = frg.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float cst = causticP(causticUV(vCW)); float up = clamp(normal.y * 0.0 + 1.0, 0.0, 1.0);
          reflectedLight.directDiffuse += reflectedLight.directDiffuse * uCausticColor * cst * uCaustic * up;
          ${boost ? `{ vec2 cu = causticUV(vCW); float c2 = causticP(cu * 1.83 + vec2(3.7, 1.9)); float web = pow(max(cst, c2 * 0.85), 1.25);
            reflectedLight.directDiffuse += reflectedLight.directDiffuse * uCausticColor * web * uCaustic * uBoost;
            totalEmissiveRadiance += uCausticColor * web * uCaustic * (uBoost * 0.025); }` : ''} }`);
    }
    sh.fragmentShader = frg;
  };
  mat.customProgramCacheKey = () => `atl-${caustic ? 1 : 0}-${sway ? 1 : 0}-${fish ? 1 : 0}-${water ? 1 : 0}-${boost ? 1 : 0}`;
  return mat;
}

/* =====================================================================
   2. Materials
   ===================================================================== */
const mats = {
  marble: patch(new THREE.MeshStandardMaterial({ color: 0xf1eadc, roughness: 0.5, metalness: 0.0 })),
  shade:  patch(new THREE.MeshStandardMaterial({ color: 0xd8dcd8, roughness: 0.62 })),
  trim:   patch(new THREE.MeshStandardMaterial({ color: 0xfbf6ec, roughness: 0.42 })),
  statue: patch(new THREE.MeshStandardMaterial({ color: 0xf5f1e8, roughness: 0.4 })),
  statueDS: patch(new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.45, side: THREE.DoubleSide })),
  dome:   patch(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.26, metalness: 0.42 })),
  gold:   patch(new THREE.MeshStandardMaterial({ color: 0xe2c07a, roughness: 0.3, metalness: 0.88 })),
  glass:  patch(new THREE.MeshStandardMaterial({ color: 0x1f4450, roughness: 0.22, metalness: 0.35, emissive: 0xffb45e, emissiveIntensity: 0 }), { caustic: false }),
  clock:  patch(new THREE.MeshStandardMaterial({ color: 0xf6efdc, roughness: 0.4, emissive: 0xffd99a, emissiveIntensity: 0 })),
  soil:   patch(new THREE.MeshStandardMaterial({ color: 0x2e4c4a, roughness: 0.95 })),
  rock:   patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }), { boost: 1.5 }),
  mesa:   patch(new THREE.MeshStandardMaterial({ color: 0x35505a, roughness: 0.95 })),
  lamp:   new THREE.MeshStandardMaterial({ color: 0xfff1d2, emissive: 0xffc073, emissiveIntensity: 0.25, roughness: 0.3 }),
  water:  patch(new THREE.MeshStandardMaterial({ color: 0x47d2dc, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86, depthWrite: false }), { caustic: false, water: true }),
  poolTile: patch(new THREE.MeshStandardMaterial({ color: 0x8fd8ec, roughness: 0.5 })),
};
const envMats = Object.values(mats);

/* =====================================================================
   3. Geometry buckets (static batching) + transforms
   ===================================================================== */
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function TM(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0){
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
const BK = {};
const DOME_FALLBACK = new THREE.Color(0x2b9db3);
function put(name, geo, m){
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  out.setAttribute('normal', g.attributes.normal);
  out.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  if (name === 'dome'){
    let c = g.attributes.color;
    if (!c){ const a = new Float32Array(n * 3); for (let i = 0; i < n; i++){ a[i*3] = DOME_FALLBACK.r; a[i*3+1] = DOME_FALLBACK.g; a[i*3+2] = DOME_FALLBACK.b; } c = new THREE.BufferAttribute(a, 3); }
    out.setAttribute('color', c);
  }
  (BK[name] ||= []).push(out);
}
const mergeNI = list => mergeGeometries(list.map(g => g.index ? g.toNonIndexed() : g), false);
const GBOX = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map();
function cylGeo(rt, rb, h, seg = 24, open = false){
  const k = `${rt.toFixed(3)}|${rb.toFixed(3)}|${h.toFixed(3)}|${seg}|${open}`;
  let g = cylCache.get(k);
  if (!g){ g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); g.translate(0, h / 2, 0); cylCache.set(k, g); }
  return g;
}
const sphCache = new Map();
function sphGeo(r, ws = 16, hs = 10){ const k = `${r}|${ws}`; let g = sphCache.get(k); if (!g){ g = new THREE.SphereGeometry(r, ws, hs); sphCache.set(k, g); } return g; }
/** box with centre y */
const box = (n, x, y, z, w, h, d, ry = 0) => put(n, GBOX, TM(x, y, z, ry, w, h, d));
/** box standing on y0 */
const boxB = (n, x, y0, z, w, h, d, ry = 0) => put(n, GBOX, TM(x, y0 + h / 2, z, ry, w, h, d));
/** cylinder standing on y0, r = bottom radius, rt = top radius */
const cyl = (n, x, y0, z, r, h, seg = 24, rt = r, ry = 0) => put(n, cylGeo(rt, r, h, seg), TM(x, y0, z, ry));

/** annulus sector prism. angle θ measured from +z toward +x: (x,z) = (r sinθ, r cosθ) */
function sectorGeo(rIn, rOut, a0, a1, h){
  const span = a1 - a0, full = span >= TAU - 1e-4;
  const segO = Math.max(8, Math.ceil(rOut * span / 1.1)), segI = Math.max(6, Math.ceil(Math.max(rIn, 0.1) * span / 1.1));
  const P = (r, a) => new THREE.Vector2(r * Math.sin(a), -r * Math.cos(a));
  let shape;
  if (full){
    const pts = []; for (let i = 0; i < segO; i++) pts.push(P(rOut, a0 + TAU * i / segO));
    shape = new THREE.Shape(pts);
    if (rIn > 0){ const hp = []; for (let i = 0; i < segI; i++) hp.push(P(rIn, a0 + TAU * i / segI)); shape.holes.push(new THREE.Path(hp)); }
  } else {
    const pts = []; for (let i = 0; i <= segO; i++) pts.push(P(rOut, a0 + span * i / segO));
    if (rIn > 0) for (let i = segI; i >= 0; i--) pts.push(P(rIn, a0 + span * i / segI)); else pts.push(new THREE.Vector2(0, 0));
    shape = new THREE.Shape(pts);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  return g;
}
const band = (n, cx, cz, rIn, rOut, y0, y1, a0 = 0, a1 = TAU) => put(n, sectorGeo(rIn, rOut, a0, a1, y1 - y0), TM(cx, y0, cz));
function arcsFromGaps(gaps){
  if (!gaps.length) return [[0, TAU]];
  const g = gaps.map(o => [normA(o.a - o.h), o.h * 2]).sort((p, q) => p[0] - q[0]);
  const arcs = [];
  for (let i = 0; i < g.length; i++){
    const start = g[i][0] + g[i][1];
    const next = i + 1 < g.length ? g[i + 1][0] : g[0][0] + TAU;
    if (next - start > 0.02) arcs.push([start, next]);
  }
  return arcs;
}

/* =====================================================================
   4. Walkable zones (first-person) + obstacles + terrain pads
   ===================================================================== */
const zones = [], obstacles = [], pads = [];
function holeContains(h, x, z){
  if (h.k === 'c') return (x - h.x) ** 2 + (z - h.z) ** 2 < h.r * h.r;
  if (h.k === 'r'){ const c = Math.cos(h.ry || 0), s = Math.sin(h.ry || 0), dx = x - h.x, dz = z - h.z; const u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) < h.hw && Math.abs(v) < h.hl; }
  if (h.k === 'a'){ const r = Math.hypot(x - h.x, z - h.z); if (r < h.r0 || r > h.r1) return false; let a = normA(Math.atan2(x - h.x, z - h.z)); let a0 = normA(h.a0); let d = normA(a - a0); return d <= (h.a1 - h.a0); }
  return false;
}
const inHoles = (holes, x, z) => holes.some(h => holeContains(h, x, z));
function zoneDisk(x, z, r, y, holes = []){ zones.push({ test: (px, pz) => (px - x) ** 2 + (pz - z) ** 2 <= r * r && !inHoles(holes, px, pz), h: () => y }); }
function zoneAnn(x, z, r0, r1, y, holes = []){ zones.push({ test: (px, pz) => { const d = Math.hypot(px - x, pz - z); return d >= r0 && d <= r1 && !inHoles(holes, px, pz); }, h: () => y }); }
function zoneRect(x, z, hw, hl, y, holes = [], ry = 0){ const c = Math.cos(ry), s = Math.sin(ry); zones.push({ test: (px, pz) => { const dx = px - x, dz = pz - z; const u = dx * c - dz * s, v = dx * s + dz * c; return Math.abs(u) <= hw && Math.abs(v) <= hl && !inHoles(holes, px, pz); }, h: () => y }); }
/** segment corridor with linear height (stairs, ramps, bridges) */
function zoneSeg(x0, z0, x1, z1, hw, y0, y1){
  const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz;
  zones.push({ test: (px, pz) => { const t = ((px - x0) * vx + (pz - z0) * vz) / L2; if (t < -0.02 || t > 1.02) return false; const cx = x0 + vx * t, cz = z0 + vz * t; return Math.hypot(px - cx, pz - cz) <= hw; },
    h: (px, pz) => { const t = clamp(((px - x0) * vx + (pz - z0) * vz) / L2, 0, 1); return y0 + (y1 - y0) * t; } });
}
const obst = (x, z, r, y0, y1) => obstacles.push({ x, z, r, y0, y1 });
/* terrain pads: c(ircle) r(ect) s(egment). sk = rock skirt that buries the podium base */
const padC = (x, z, r, top, sk) => pads.push({ k: 'c', x, z, r, top, sk });
const padR = (x, z, hw, hl, top, sk) => pads.push({ k: 'r', x, z, hw, hl, top, sk });
const padS = (x0, z0, x1, z1, hw, top) => pads.push({ k: 's', x0, z0, x1, z1, hw, top, sk: null });
function sdf(p, x, z){
  if (p.k === 'c') return Math.hypot(x - p.x, z - p.z) - p.r;
  if (p.k === 'r'){ const qx = Math.abs(x - p.x) - p.hw, qz = Math.abs(z - p.z) - p.hl; return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0); }
  const vx = p.x1 - p.x0, vz = p.z1 - p.z0, L2 = vx * vx + vz * vz;
  const t = clamp(((x - p.x0) * vx + (z - p.z0) * vz) / L2, 0, 1);
  return Math.hypot(x - (p.x0 + vx * t), z - (p.z0 + vz * t)) - p.hw;
}

/* =====================================================================
   5. Architectural components
   ===================================================================== */
const balM = [];          // baluster instance matrices
const lampPts = [];       // lamp globe positions
const plantLists = { bush: [], weed: [], coral1: [], coral2: [], coral3: [], tube: [], table: [], brain: [], fan: [], anem: [], glow: [], boulder: [], kelp: [] };

/* --- fluted column --- */
const colCache = new Map();
function colGeo(h, r){
  const k = h.toFixed(2) + '|' + r.toFixed(2);
  if (colCache.has(k)) return colCache.get(k);
  const sh = h - 0.95;
  const shaft = new THREE.CylinderGeometry(r * 0.87, r, sh, 24, 1, true);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), z = p.getZ(i); const kk = Math.round(Math.atan2(x, z) / (TAU / 24));
    if (((kk % 2) + 2) % 2 === 1){ p.setX(i, x * 0.9); p.setZ(i, z * 0.9); }
  }
  shaft.computeVertexNormals(); shaft.translate(0, 0.45 + sh / 2, 0);
  const ech = new THREE.CylinderGeometry(r * 1.32, r * 0.87, 0.3, 24); ech.translate(0, h - 0.35, 0);
  const plinth = new THREE.BoxGeometry(r * 2.8, 0.22, r * 2.8); plinth.translate(0, 0.11, 0);
  const tor = new THREE.CylinderGeometry(r * 1.05, r * 1.28, 0.23, 24); tor.translate(0, 0.335, 0);
  const abac = new THREE.BoxGeometry(r * 2.9, 0.2, r * 2.9); abac.translate(0, h - 0.1, 0);
  const res = { main: mergeNI([shaft, ech]), deco: mergeNI([plinth, tor, abac]) };
  colCache.set(k, res); return res;
}
function column(x, y0, z, h, r = 0.5, walk = false, ry = 0){
  const g = colGeo(h, r); const m = TM(x, y0, z, ry);
  put('marble', g.main, m); put('trim', g.deco, m);
  if (walk) obst(x, z, r * 1.25, y0 - 0.5, y0 + h);
}

/* --- arched window: emissive glass + carved frame --- */
const winCache = new Map();
function archPath(P, w, h, y0 = 0){ const r = w / 2; P.moveTo(-r, y0); P.lineTo(r, y0); P.lineTo(r, y0 + h - r); P.absarc(0, y0 + h - r, r, 0, Math.PI, false); P.lineTo(-r, y0); return P; }
function winGeo(w, h){
  const k = w.toFixed(2) + '|' + h.toFixed(2);
  if (winCache.has(k)) return winCache.get(k);
  const glass = new THREE.ShapeGeometry(archPath(new THREE.Shape(), w, h), 8);
  const t = Math.min(0.28, w * 0.18);
  const outer = new THREE.Shape(); const Rr = w / 2 + t;
  outer.moveTo(-Rr, -t); outer.lineTo(Rr, -t); outer.lineTo(Rr, h - w / 2); outer.absarc(0, h - w / 2, Rr, 0, Math.PI, false); outer.lineTo(-Rr, -t);
  outer.holes.push(archPath(new THREE.Path(), w, h));
  const frame = new THREE.ExtrudeGeometry(outer, { depth: 0.18, bevelEnabled: false, curveSegments: 8 });
  const res = { glass, frame }; winCache.set(k, res); return res;
}
const _tz = new THREE.Matrix4().makeTranslation(0, 0, 0.07);
function win(x, y, z, ry, w = 1.2, h = 2.8){
  const g = winGeo(w, h); const m = TM(x, y, z, ry);
  put('glass', g.glass, m.clone().multiply(_tz)); put('trim', g.frame, m);
}
/** windows on the 4 faces of an axis-aligned block */
function boxWins(cx, cz, w, d, y, nx, nz, ww, wh, faces = 'nsew'){
  if (faces.includes('s')) for (let i = 0; i < nx; i++){ const u = -w / 2 + w * (i + 0.5) / nx; win(cx + u, y, cz + d / 2, 0, ww, wh); }
  if (faces.includes('n')) for (let i = 0; i < nx; i++){ const u = -w / 2 + w * (i + 0.5) / nx; win(cx + u, y, cz - d / 2, Math.PI, ww, wh); }
  if (faces.includes('e')) for (let i = 0; i < nz; i++){ const u = -d / 2 + d * (i + 0.5) / nz; win(cx + w / 2, y, cz + u, Math.PI / 2, ww, wh); }
  if (faces.includes('w')) for (let i = 0; i < nz; i++){ const u = -d / 2 + d * (i + 0.5) / nz; win(cx - w / 2, y, cz + u, -Math.PI / 2, ww, wh); }
}
function ringWins(cx, cz, r, y, n, ww, wh, a0 = 0){ for (let i = 0; i < n; i++){ const a = a0 + i * TAU / n; win(cx + r * Math.sin(a), y, cz + r * Math.cos(a), a, ww, wh); } }

/* --- balustrades --- */
function lineRail(x0, z0, y0, x1, z1, y1){
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.6) return;
  const n = Math.max(1, Math.round(L / 0.62));
  for (let i = 0; i < n; i++){ const t = (i + 0.5) / n; balM.push(TM(x0 + dx * t, mix(y0, y1, t), z0 + dz * t)); }
  const dy = y1 - y0, ry = Math.atan2(dx, dz), rx = -Math.atan2(dy, L), Lp = Math.hypot(L, dy);
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
  put('trim', GBOX, TM(mx, my + 0.93, mz, ry, 0.32, 0.14, Lp, rx));
  put('trim', GBOX, TM(mx, my + 0.06, mz, ry, 0.36, 0.12, Lp, rx));
  const np = Math.max(1, Math.round(L / 6.5));
  for (let i = 0; i <= np; i++){ const t = i / np; boxB('marble', x0 + dx * t, mix(y0, y1, t), z0 + dz * t, 0.44, 1.14, 0.44, ry); }
}
function ringRail(cx, cz, r, y, a0, a1){
  const L = r * (a1 - a0); const n = Math.max(1, Math.round(L / 0.62));
  for (let i = 0; i < n; i++){ const a = a0 + (a1 - a0) * (i + 0.5) / n; balM.push(TM(cx + r * Math.sin(a), y, cz + r * Math.cos(a))); }
  band('trim', cx, cz, r - 0.16, r + 0.16, y + 0.86, y + 1.0, a0, a1);
  band('trim', cx, cz, r - 0.18, r + 0.18, y, y + 0.12, a0, a1);
  const np = Math.max(1, Math.round(L / 6.5));
  for (let i = 0; i <= np; i++){ const a = a0 + (a1 - a0) * i / np; boxB('marble', cx + r * Math.sin(a), y, cz + r * Math.cos(a), 0.44, 1.14, 0.44, a); }
}
const ringRailGaps = (cx, cz, r, y, gaps) => arcsFromGaps(gaps).forEach(([a, b]) => ringRail(cx, cz, r, y, a, b));

/* --- lamps --- */
function lampPost(x, y, z, h = 3.4){
  cyl('shade', x, y, z, 0.17, h, 8, 0.12);
  boxB('trim', x, y, z, 0.62, 0.36, 0.62);
  put('gold', cylGeo(0.0, 0.32, 0.42, 8), TM(x, y + h + 0.6, z));
  put('gold', cylGeo(0.36, 0.2, 0.12, 8), TM(x, y + h - 0.05, z));
  lampPts.push([x, y + h + 0.32, z]);
  obst(x, z, 0.4, y - 0.5, y + h);
}
function hangLamp(x, y, z){ lampPts.push([x, y, z]); put('gold', cylGeo(0.0, 0.26, 0.32, 6), TM(x, y + 0.26, z)); cyl('gold', x, y + 0.5, z, 0.03, 0.9, 4); }

/* --- segmented (lobed) dome --- */
const domeCache = new Map();
const DOME_BASE = new THREE.Color(0x2a9db4), DOME_LITE = new THREE.Color(0x7fdbe4);
function domeGeo(r, hs, lobes){
  const k = `${r.toFixed(2)}|${hs}|${lobes}`;
  if (domeCache.has(k)) return domeCache.get(k);
  const pts = []; const N = 16;
  for (let i = 0; i <= N; i++){ const t = i / N * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(r * Math.cos(t), 0), r * hs * Math.sin(t))); }
  const g = new THREE.LatheGeometry(pts, lobes * 6);
  const p = g.attributes.position; const col = new Float32Array(p.count * 3); const c = new THREE.Color();
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let f = (Math.atan2(x, z) / TAU) * lobes; f -= Math.floor(f);
    const s = Math.sin(Math.PI * f); const yy = y / (r * hs);
    const kk = 1 + 0.055 * s * (1 - Math.pow(yy, 3));
    p.setX(i, x * kk); p.setZ(i, z * kk);
    c.copy(DOME_BASE).lerp(DOME_LITE, 0.12 + 0.42 * s * (0.45 + 0.55 * yy));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const ribs = [];
  for (let kq = 0; kq < lobes; kq++){
    const ph = kq * TAU / lobes; const rp = [];
    for (let i = 0; i <= 12; i++){ const t = i / 12 * Math.PI / 2 * 0.965; const px = r * Math.cos(t) * 1.006; rp.push(new THREE.Vector3(px * Math.sin(ph), r * hs * Math.sin(t), px * Math.cos(ph))); }
    ribs.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 16, Math.max(0.05, r * 0.018), 4, false));
  }
  const ring = new THREE.TorusGeometry(r * 1.012, Math.max(0.07, r * 0.03), 6, 64); ring.rotateX(Math.PI / 2);
  ribs.push(ring);
  const res = { shell: g, ribs: mergeNI(ribs) }; domeCache.set(k, res); return res;
}
/** drum + lobed dome + lantern + finial. returns top y */
function domeAsm(x, y, z, r, o = {}){
  const drumH = o.drumH ?? r * 0.7, cols = o.cols ?? 16, hs = o.hs ?? 1.1, lobes = o.lobes ?? 12, lantern = o.lantern ?? true, spire = o.spire ?? r * 0.75;
  let yy = y;
  if (drumH > 0){
    band('trim', x, z, 0, r + 0.4, y, y + 0.45);
    cyl('shade', x, y + 0.45, z, r * 0.95, drumH - 0.45, 48);
    if (cols > 0){
      const ch = drumH - 1.15;
      for (let i = 0; i < cols; i++){ const a = i * TAU / cols; column(x + r * 0.99 * Math.sin(a), y + 0.45, z + r * 0.99 * Math.cos(a), ch, Math.max(0.18, r * 0.045)); }
      if (drumH > 2.2) ringWins(x, z, r * 0.95, y + 0.45 + ch * 0.18, cols, Math.min(1.1, r * 0.17), ch * 0.62, Math.PI / cols);
    }
    band('trim', x, z, 0, r + 0.55, y + drumH - 0.7, y + drumH);
    yy = y + drumH;
  }
  const dg = domeGeo(r, hs, lobes);
  put('dome', dg.shell, TM(x, yy, z)); put('gold', dg.ribs, TM(x, yy, z));
  let top = yy + r * hs;
  if (lantern){
    const lr = Math.max(0.5, r * 0.2), lh = lr * 1.6, base = yy + r * hs * 0.965;
    cyl('marble', x, base, z, lr, lh, 16);
    for (let i = 0; i < 6; i++){ const a = i * TAU / 6 + 0.5; win(x + lr * Math.sin(a), base + lh * 0.15, z + lr * Math.cos(a), a, lr * 0.55, lh * 0.65); }
    band('trim', x, z, 0, lr + 0.18, base + lh, base + lh + 0.18);
    const sd = domeGeo(lr * 1.08, 1.05, 8);
    put('dome', sd.shell, TM(x, base + lh + 0.18, z)); put('gold', sd.ribs, TM(x, base + lh + 0.18, z));
    const ft = base + lh + 0.18 + lr * 1.08 * 1.05 - 0.05;
    put('gold', sphGeo(lr * 0.28, 10, 8), TM(x, ft + lr * 0.2, z));
    cyl('gold', x, ft + lr * 0.3, z, lr * 0.12, spire, 6, 0.0);
    top = ft + lr * 0.3 + spire;
  }
  return top;
}

/* --- clock face --- */
const clockDisc = (() => { const g = new THREE.CylinderGeometry(1, 1, 0.2, 40); g.rotateX(Math.PI / 2); return g; })();
const clockRing = new THREE.TorusGeometry(1, 0.075, 6, 40);
function clockFace(x, y, z, ry, r){
  const off = (dx, dy, dz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + dx * c + dz * s, y + dy, z - dx * s + dz * c]; };
  let [px, py, pz] = off(0, 0, 0.1);
  put('clock', clockDisc, TM(px, py, pz, ry, r, r, 1));
  put('gold', clockRing, TM(px, py, pz + 0, ry, r, r, r)); [px, py, pz] = off(0, 0, 0.22);
  for (let i = 0; i < 12; i++){ const a = i * TAU / 12; const [tx, ty, tz] = off(Math.sin(a) * r * 0.8, Math.cos(a) * r * 0.8, 0.22); put('gold', GBOX, TM(tx, ty, tz, ry, r * 0.07, r * 0.2, 0.05, 0, -a)); }
  put('gold', GBOX, TM(...off(Math.sin(2.1) * r * 0.22, Math.cos(2.1) * r * 0.22, 0.26), ry, r * 0.09, r * 0.5, 0.05, 0, -2.1));
  put('gold', GBOX, TM(...off(Math.sin(-0.5) * r * 0.32, Math.cos(-0.5) * r * 0.32, 0.28), ry, r * 0.06, r * 0.7, 0.05, 0, 0.5));
}

/* --- square tower with clock stage, belfry, spire or dome --- */
function squareTower(x, y0, z, w, H, o = {}){
  const top = o.top ?? 'spire', clock = o.clock ?? true;
  boxB('shade', x, y0 - 8, z, w, H + 8, w);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) boxB('marble', x + sx * w / 2, y0, z + sz * w / 2, 0.95, H, 0.95);
  const levels = Math.max(1, Math.floor(H / 7));
  for (let l = 0; l < levels; l++){
    const yy = y0 + l * (H / levels);
    if (l > 0) boxB('trim', x, yy - 0.2, z, w + 0.5, 0.4, w + 0.5);
    const nw = w > 6.2 ? 2 : 1; const wh = Math.min(3.2, H / levels * 0.48);
    boxWins(x, z, w, w, yy + (H / levels) * 0.25, nw, nw, Math.min(1.25, w * 0.2), wh);
  }
  boxB('trim', x, y0 + H, z, w + 1.0, 0.7, w + 1.0);
  let yt = y0 + H + 0.7;
  const w2 = w * 0.86, h2 = w2 * 0.95;
  boxB('marble', x, yt, z, w2, h2, w2);
  if (clock){ const cr = w2 * 0.32; clockFace(x, yt + h2 / 2, z + w2 / 2, 0, cr); clockFace(x, yt + h2 / 2, z - w2 / 2, Math.PI, cr); clockFace(x + w2 / 2, yt + h2 / 2, z, Math.PI / 2, cr); clockFace(x - w2 / 2, yt + h2 / 2, z, -Math.PI / 2, cr); }
  else boxWins(x, z, w2, w2, yt + h2 * 0.2, 1, 1, w2 * 0.3, h2 * 0.6);
  boxB('trim', x, yt + h2, z, w2 + 0.6, 0.5, w2 + 0.6);
  yt += h2 + 0.5;
  const w3 = w2 * 0.86, h3 = w3 * 1.15;
  boxB('shade', x, yt, z, w3 * 0.84, h3, w3 * 0.84);
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) boxB('marble', x + sx * w3 * 0.42, yt, z + sz * w3 * 0.42, 0.85, h3, 0.85);
  boxWins(x, z, w3 * 0.84, w3 * 0.84, yt + 0.5, 1, 1, w3 * 0.46, h3 * 0.74);
  boxB('trim', x, yt + h3, z, w3 + 0.5, 0.45, w3 + 0.5);
  yt += h3 + 0.45;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]){
    const px = x + sx * w3 * 0.46, pz = z + sz * w3 * 0.46;
    cyl('marble', px, yt, pz, 0.36, 1.2, 8); cyl('shade', px, yt + 1.2, pz, 0.4, 2.2, 8, 0.0); put('gold', sphGeo(0.12, 8, 6), TM(px, yt + 3.45, pz));
  }
  if (top === 'dome') return domeAsm(x, yt, z, w3 * 0.44, { drumH: w3 * 0.45, cols: 8, hs: 1.12, lobes: 10, spire: w * 0.5 });
  const sr = w3 * 0.44;
  cyl('marble', x, yt, z, sr, w3 * 0.5, 8);
  for (let i = 0; i < 8; i++){ const a = Math.PI / 8 + i * Math.PI / 4; const ap = sr * Math.cos(Math.PI / 8); win(x + ap * Math.sin(a), yt + 0.25, z + ap * Math.cos(a), a, sr * 0.36, w3 * 0.36); }
  band('trim', x, z, 0, sr + 0.3, yt + w3 * 0.5, yt + w3 * 0.5 + 0.3);
  const sh = o.spireH ?? w * 1.55; const y2 = yt + w3 * 0.5 + 0.3;
  cyl('shade', x, y2, z, sr * 0.98, sh, 8, 0.0);
  band('gold', x, z, sr * 0.62, sr * 0.75, y2 + sh * 0.3, y2 + sh * 0.3 + 0.18);
  put('gold', sphGeo(0.28, 10, 8), TM(x, y2 + sh + 0.1, z));
  cyl('gold', x, y2 + sh + 0.25, z, 0.08, 1.6, 6, 0.0);
  return y2 + sh + 1.85;
}

/* --- octagonal gothic tower with lancet windows and spire --- */
function gothicTower(x, y0, z, r, H, spH){
  cyl('shade', x, y0 - 8, z, r, H + 8, 8);
  for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4; boxB('marble', x + r * Math.sin(a), y0, z + r * Math.cos(a), 0.6, H, 0.6, a); }
  const ap = r * Math.cos(Math.PI / 8);
  const lv = Math.max(2, Math.round(H / 8));
  for (let l = 0; l < lv; l++){
    const yy = y0 + 2 + l * (H - 3) / lv;
    for (let k = 0; k < 8; k++){ const a = Math.PI / 8 + k * Math.PI / 4; win(x + ap * Math.sin(a), yy, z + ap * Math.cos(a), a, Math.min(1.0, r * 0.3), Math.min(3.6, (H - 3) / lv * 0.62)); }
    if (l > 0) cyl('trim', x, yy - 0.8, z, r * 1.05, 0.35, 8);
  }
  cyl('trim', x, y0 + H, z, r * 1.14, 0.6, 8);
  for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4; const px = x + r * 1.05 * Math.sin(a), pz = z + r * 1.05 * Math.cos(a); cyl('shade', px, y0 + H + 0.6, pz, 0.32, 2.6, 6, 0.0); }
  const r2 = r * 0.72, h2 = r * 1.6, y1 = y0 + H + 0.6;
  cyl('marble', x, y1, z, r2, h2, 8);
  const ap2 = r2 * Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k++){ const a = Math.PI / 8 + k * Math.PI / 4; win(x + ap2 * Math.sin(a), y1 + 0.4, z + ap2 * Math.cos(a), a, Math.min(0.8, r2 * 0.32), h2 * 0.62); }
  cyl('trim', x, y1 + h2, z, r2 * 1.12, 0.4, 8);
  const y2 = y1 + h2 + 0.4;
  cyl('shade', x, y2, z, r2 * 0.98, spH, 8, 0.0);
  band('gold', x, z, r2 * 0.55, r2 * 0.68, y2 + spH * 0.33, y2 + spH * 0.33 + 0.2);
  put('gold', sphGeo(0.26, 10, 8), TM(x, y2 + spH + 0.05, z));
  cyl('gold', x, y2 + spH + 0.2, z, 0.07, 1.4, 6, 0.0);
  return y2 + spH + 1.6;
}

/* --- round open temple (tholos) --- */
function tholos(x, y, z, r, walk = false){
  band('trim', x, z, 0, r + 1.0, y, y + 0.3);
  band('marble', x, z, 0, r + 0.5, y + 0.3, y + 0.6);
  const y1 = y + 0.6, ch = 6.2, n = 10;
  for (let i = 0; i < n; i++){ const a = i * TAU / n + 0.31; column(x + (r - 0.4) * Math.sin(a), y1, z + (r - 0.4) * Math.cos(a), ch, 0.42, walk); }
  band('trim', x, z, r - 1.1, r + 0.25, y1 + ch, y1 + ch + 0.95);
  band('marble', x, z, 0, r - 1.0, y1 + ch + 0.2, y1 + ch + 0.95);
  domeAsm(x, y1 + ch + 0.95, z, r * 0.92, { drumH: 0.9, cols: 0, hs: 0.98, lobes: 12, spire: r * 0.5 });
  cyl('marble', x, y1, z, 0.75, 1.2, 16); cyl('trim', x, y1 + 1.2, z, 0.95, 0.2, 16);
  lampPts.push([x, y1 + 1.75, z]); put('gold', cylGeo(0.0, 0.42, 0.5, 8), TM(x, y1 + 1.4, z));
  if (walk) obst(x, z, 1.25, y1 - 1, y1 + 3);
}

/* --- arch-pierced wall (bridges, aqueducts) --- */
function archHole(cx, yb, span, rise){
  const P = new THREE.Path();
  if (rise >= span / 2){ const r = span / 2; P.moveTo(cx - r, yb); P.lineTo(cx + r, yb); P.lineTo(cx + r, yb + rise - r); P.absarc(cx, yb + rise - r, r, 0, Math.PI, false); P.lineTo(cx - r, yb); }
  else { const Rr = (span * span / 4 + rise * rise) / (2 * rise); const cy = yb + rise - Rr; const a0 = Math.atan2(yb - cy, span / 2); P.moveTo(cx - span / 2, yb); P.lineTo(cx + span / 2, yb); P.absarc(cx, cy, Rr, a0, Math.PI - a0, false); P.lineTo(cx - span / 2, yb); }
  return P;
}
function bridge(x0, z0, y0, x1, z1, y1, w, o = {}){
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ry = Math.atan2(-uz, ux);
  const base = o.base ?? -30;
  const deck = s => y0 + (y1 - y0) * s / L;
  const shape = new THREE.Shape(); shape.moveTo(0, base); shape.lineTo(L, base); shape.lineTo(L, y1); shape.lineTo(0, y0); shape.closePath();
  const P1 = o.p1 ?? 10.5, sp1 = P1 * 0.66;
  const n1 = Math.max(1, Math.floor((L - 3) / P1)), off = (L - n1 * P1) / 2;
  for (let i = 0; i < n1; i++){ const sc = off + P1 * (i + 0.5); const top = deck(sc) - 11.2; if (top - base > 6) shape.holes.push(archHole(sc, base + 0.7, sp1, top - base - 0.7)); }
  for (let j = 0; j < n1 * 2; j++){ const sc = off + P1 / 2 * (j + 0.5); const yb = deck(sc) - 9.4; shape.holes.push(archHole(sc, yb, P1 / 2 * 0.6, 6.4)); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 10 }); geo.translate(0, 0, -w / 2);
  put('shade', geo, TM(x0, 0, z0, ry));
  const hry = Math.atan2(ux, uz), rx = -Math.atan2(y1 - y0, L), Lp = Math.hypot(L, y1 - y0);
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2;
  put('trim', GBOX, TM(mx, my - 10.3, mz, hry, w + 0.7, 0.7, Lp, rx));
  put('trim', GBOX, TM(mx, my - 0.3, mz, hry, w + 0.9, 0.62, Lp, rx));
  put('marble', GBOX, TM(mx, my + 0.02, mz, hry, w - 0.2, 0.06, Lp, rx));
  const nx = -uz, nz = ux, ho = w / 2 - 0.3;
  lineRail(x0 + nx * ho, z0 + nz * ho, y0, x1 + nx * ho, z1 + nz * ho, y1);
  lineRail(x0 - nx * ho, z0 - nz * ho, y0, x1 - nx * ho, z1 - nz * ho, y1);
  const nl = Math.max(1, Math.floor(L / 15));
  for (let i = 1; i < nl; i++){ const t = i / nl, side = i % 2 ? 1 : -1; lampPost(x0 + dx * t + nx * (ho - 0.7) * side, mix(y0, y1, t), z0 + dz * t + nz * (ho - 0.7) * side, 3.0); }
  zoneSeg(x0, z0, x1, z1, w / 2 - 0.75, y0, y1);
  padS(x0, z0, x1, z1, w / 2 + 1.5, Math.min(y0, y1) - 1.6);
}
/** small single-arch bridge over a canal */
function canalBridge(cx, cz, a, r0, r1, yb, yt, w){
  const L = r1 - r0, ux = Math.sin(a), uz = Math.cos(a), ry = Math.atan2(-uz, ux);
  const x0 = cx + ux * r0, z0 = cz + uz * r0;
  const shape = new THREE.Shape(); shape.moveTo(0, yb); shape.lineTo(L, yb); shape.lineTo(L, yt); shape.lineTo(0, yt); shape.closePath();
  shape.holes.push(archHole(L / 2, yb + 0.06, L * 0.56, (yt - yb) * 0.66));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false, curveSegments: 10 }); geo.translate(0, 0, -w / 2);
  put('shade', geo, TM(x0, 0, z0, ry));
  const nx = -uz, nz = ux, ho = w / 2 - 0.15, hry = Math.atan2(ux, uz);
  for (const s of [1, -1]) put('trim', GBOX, TM(cx + ux * (r0 + L / 2) + nx * ho * s, yt + 0.32, cz + uz * (r0 + L / 2) + nz * ho * s, hry, 0.3, 0.64, L));
  zoneSeg(x0, z0, cx + ux * r1, cz + uz * r1, w / 2 - 0.55, yt, yt);
}

/* --- stairs: solid steps, stepped cheek walls, lamps --- */
function stairs(x0, z0, y0, x1, z1, y1, width, o = {}){
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, ry = Math.atan2(ux, uz);
  const n = Math.max(2, Math.round(Math.abs(y1 - y0) / 0.24)), t = L / n, lo = Math.min(y0, y1) - 1.2;
  const nx = -uz, nz = ux;
  for (let i = 0; i < n; i++){
    const top = y0 + (y1 - y0) * (i + 1) / n, s = (i + 0.5) * t;
    const h = top - lo; put('marble', GBOX, TM(x0 + ux * s, lo + h / 2, z0 + uz * s, ry, width, h, t + 0.02));
    put('trim', GBOX, TM(x0 + ux * (s + (y1 > y0 ? -t / 2 : t / 2)), top - 0.04, z0 + uz * (s + (y1 > y0 ? -t / 2 : t / 2)), ry, width + 0.02, 0.08, 0.1));
  }
  const seg = 3;
  for (let i = 0; i < n; i += seg){
    const k = Math.min(seg, n - i); const s = (i + k / 2) * t; const top = Math.max(y0 + (y1 - y0) * (i + 1) / n, y0 + (y1 - y0) * (i + k) / n) + 0.95;
    for (const sd of [1, -1]){ const px = x0 + ux * s + nx * (width / 2 + 0.45) * sd, pz = z0 + uz * s + nz * (width / 2 + 0.45) * sd; put('shade', GBOX, TM(px, (top + lo) / 2, pz, ry, 0.9, top - lo, k * t + 0.02)); put('trim', GBOX, TM(px, top + 0.08, pz, ry, 1.05, 0.16, k * t + 0.04)); }
  }
  if (o.lamps !== false) for (const [px, pz, py] of [[x0, z0, y0], [x1, z1, y1]]) for (const sd of [1, -1]) lampPost(px + nx * (width / 2 + 0.45) * sd, py + (o.lampLift ?? 1.1), pz + nz * (width / 2 + 0.45) * sd, 2.6);
  zoneSeg(x0, z0, x1, z1, width / 2 - 0.45, y0, y1);
  zoneSeg(x0 - ux * 1.2, z0 - uz * 1.2, x0, z0, width / 2 - 0.45, y0, y0);
  zoneSeg(x1, z1, x1 + ux * 1.2, z1 + uz * 1.2, width / 2 - 0.45, y1, y1);
  padS(x0, z0, x1, z1, width / 2 + 1.2, Math.min(y0, y1) - 0.5);
}

/* --- disk podium (stone platform embedded in rock) --- */
function diskPodium(x, z, r, top, bottom, o = {}){
  cyl('shade', x, bottom, z, r, top - 0.8 - bottom, Math.max(48, Math.round(r * 2.4)));
  band('trim', x, z, r - 0.3, r + 0.6, top - 0.8, top);
  band('marble', x, z, 0, r - 0.3, top - 0.8, top);
  const np = o.pilasters ?? Math.round(TAU * r / 6);
  for (let i = 0; i < np; i++){ const a = i * TAU / np; boxB('trim', x + (r + 0.15) * Math.sin(a), bottom, z + (r + 0.15) * Math.cos(a), 1.0, top - 0.8 - bottom, 0.45, a); }
}

/* =====================================================================
   6. City layout — 图1 中央圣殿 · 图2 正面阶梯与环形水道 · 图3 天际线 · 图4 侧翼拱廊桥
   ===================================================================== */
const PL = [];                       // warm practical lights (night)
const waterGeos = [];
function waterDisk(x, y, z, r){ const g = new THREE.CircleGeometry(r, 48); g.rotateX(-Math.PI / 2); g.translate(x, y, z); waterGeos.push(g); }
function waterRing(x, y, z, r0, r1){ const g = new THREE.RingGeometry(r0, r1, 128, 1); g.rotateX(-Math.PI / 2); g.translate(x, y, z); waterGeos.push(g); }
function waterArc(x, y, z, r0, r1, a0, a1){ const g = new THREE.RingGeometry(r0, r1, Math.max(8, Math.round((a1 - a0) * 40)), 1, a0 - Math.PI / 2, a1 - a0); g.rotateX(-Math.PI / 2); g.translate(x, y, z); waterGeos.push(g); }
function waterRect(x, y, z, w, d){ const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, y, z); waterGeos.push(g); }
function planterRing(x, y, z, r){ band('trim', x, z, r - 0.25, r, y, y + 0.55); band('soil', x, z, 0, r - 0.25, y, y + 0.42); plantCluster(x, y + 0.42, z, r - 0.5, Math.round(r * r * 2.2)); obst(x, z, r + 0.35, y - 1, y + 3); }

/* ---------- court (图2): ring canal, double colonnade, fountain, grand stair ---------- */
function buildCourt(){
  const cx = 0, cz = 84, y = 2;
  padC(cx, cz, 34.6, y, { drop: 2.6, slope: 0.5, range: 14 });
  cyl('shade', cx, -12, cz, 22, 13.85, 112);
  band('marble', cx, cz, 0, 21.9, 1.85, 2.0);
  band('trim', cx, cz, 21.9, 22.4, 1.6, 2.0);
  for (const rr of [9.5, 15.5]) band('trim', cx, cz, rr, rr + 0.45, 2.0, 2.04);
  cyl('shade', cx, -12, cz, 27.4, 12.3, 112);
  band('shade', cx, cz, 27, 34, -12, 1.6);
  band('trim', cx, cz, 26.9, 34.6, 1.6, 2.0);
  for (let i = 0; i < 36; i++){ const a = i * TAU / 36; boxB('trim', cx + 34.7 * Math.sin(a), -2, cz + 34.7 * Math.cos(a), 1.0, 3.6, 0.45, a); }
  waterRing(cx, 1.42, cz, 22.3, 27.05); band('poolTile', cx, cz, 21.95, 27.1, 0.2, 0.62);
  const BR = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  for (const a of BR) canalBridge(cx, cz, a, 21.4, 28.0, 0.3, 2.04, 3.8);
  const bgap = BR.map(a => ({ a, h: 0.105 }));
  ringRailGaps(cx, cz, 21.75, 2.0, bgap);
  ringRailGaps(cx, cz, 27.3, 2.0, BR.map(a => ({ a, h: 0.085 })));
  const gates = [{ a: 0, h: 0.17 }, { a: Math.PI, h: 0.25 }, { a: -Math.PI / 2, h: 0.11 }, { a: Math.PI / 2, h: 0.1 }, { a: -50 * Math.PI / 180, h: 0.17 }];
  ringRailGaps(cx, cz, 34.0, 2.0, gates);
  const colGates = [{ a: 0, h: 0.13 }, { a: Math.PI, h: 0.2 }, { a: -Math.PI / 2, h: 0.09 }, { a: Math.PI / 2, h: 0.09 }, { a: -50 * Math.PI / 180, h: 0.14 }];
  const CH = 6.2, ytop = y + CH;
  for (const [a0, a1] of arcsFromGaps(colGates)){
    for (const rr of [28.5, 32.6]){
      const n = Math.max(1, Math.round(rr * (a1 - a0) / 3.4));
      for (let i = 0; i <= n; i++){ const a = a0 + (a1 - a0) * i / n; column(cx + rr * Math.sin(a), y, cz + rr * Math.cos(a), CH, 0.5, true); }
    }
    band('trim', cx, cz, 27.8, 33.3, ytop, ytop + 0.95, a0, a1);
    band('marble', cx, cz, 27.6, 33.5, ytop + 0.95, ytop + 1.45, a0, a1);
    ringRail(cx, cz, 33.2, ytop + 1.45, a0, a1); ringRail(cx, cz, 27.9, ytop + 1.45, a0, a1);
    for (const a of [a0, a1]){ for (const rr of [28.5, 32.6]) boxB('marble', cx + rr * Math.sin(a), y, cz + rr * Math.cos(a), 1.5, CH + 1.45, 1.5, a); }
    const nl = Math.max(1, Math.round(30.5 * (a1 - a0) / 7.5));
    for (let i = 0; i < nl; i++){ const a = a0 + (a1 - a0) * (i + 0.5) / nl; hangLamp(cx + 30.55 * Math.sin(a), ytop - 1.4, cz + 30.55 * Math.cos(a)); }
  }
  // fountain + sea-king statue
  band('trim', cx, cz, 5.9, 6.6, 2.0, 2.85); band('shade', cx, cz, 0, 5.9, 2.0, 2.3);
  waterDisk(cx, 2.62, cz, 5.95);
  cyl('marble', cx, 2.0, cz, 2.1, 1.5, 32); band('trim', cx, cz, 0, 2.5, 3.5, 3.85);
  cyl('marble', cx, 3.85, cz, 1.25, 1.6, 24); band('trim', cx, cz, 0, 1.6, 5.45, 5.7);
  waterDisk(cx, 3.82, cz, 2.45);
  poseidon(cx, 5.7, cz, 6.6);
  PL.push([cx, 7, cz + 6]);
  // round pools and coral planters
  for (const sx of [-1, 1]){
    band('trim', cx + sx * 14.5, cz, 4.3, 4.8, 2.0, 2.6); band('shade', cx + sx * 14.5, cz, 0, 4.3, 2.0, 2.15); waterDisk(cx + sx * 14.5, 2.45, cz, 4.32);
    for (const pz of [-11, 11]) planterRing(cx + sx * 15, y, cz + pz, 2.4);
    lampPost(cx + sx * 8.6, y, cz - 14, 3.2); lampPost(cx + sx * 8.6, y, cz + 14, 3.2);
  }
  const holes = [{ k: 'c', x: cx, z: cz, r: 7.1 }, { k: 'c', x: cx - 14.5, z: cz, r: 5.25 }, { k: 'c', x: cx + 14.5, z: cz, r: 5.25 }];
  zoneDisk(cx, cz, 21.45, y, holes);
  zoneAnn(cx, cz, 27.75, 33.55, y);
  // grand stair to the acropolis (T1)
  stairs(0, 50.6, 2, 0, 37.2, 8, 14, { lampLift: 1.0 });
  PL.push([0, 6.5, 56]);
  // front stair down to the reef landing
  stairs(0, 118.2, 2, 0, 127.2, 0, 10);
  padR(0, 131.5, 9.5, 4.6, 0, { drop: 1.4, slope: 0.5, range: 8 });
  boxB('shade', 0, -7, 131.5, 18.6, 6.7, 8.8); boxB('trim', 0, -0.3, 131.5, 19.2, 0.3, 9.4);
  lineRail(-9.2, 127.5, 0, -9.2, 135.6, 0); lineRail(9.2, 127.5, 0, 9.2, 135.6, 0); lineRail(-9.2, 135.6, 0, -2.8, 135.6, 0); lineRail(2.8, 135.6, 0, 9.2, 135.6, 0);
  zoneRect(0, 131.4, 8.6, 4.0, 0);
  // gate towers (图2 clock towers)
  for (const sx of [-1, 1]){ const tx = sx * 30.3, tz = 62.8; padC(tx, tz, 4.6, y, { drop: 2.2, slope: 0.6, range: 9 }); squareTower(tx, y, tz, 6, 20, { top: 'dome', clock: true }); }
  // tholos terrace at the front-left (图2)
  const tx = -31, tz = 110;
  padC(tx, tz, 8.4, y, { drop: 2.2, slope: 0.6, range: 10 });
  cyl('shade', tx, -12, tz, 8, 13.6, 48); band('trim', tx, tz, 0, 8.45, 1.6, 2.0);
  const toCourt = Math.atan2(cx - tx, cz - tz);
  ringRailGaps(tx, tz, 8.05, 2.0, [{ a: toCourt, h: 0.75 }]);
  tholos(tx, 2.0, tz, 5.4, true);
  zoneDisk(tx, tz, 5.6, 2.6);
  zoneAnn(tx, tz, 5.4, 7.6, 2.0);
}

/* ---------- Tripo models: upright, front toward +z, base on y = 0, scaled to a height ---------- */
function fitTripo(gltf, height, { glow = 0.12, caustic = true } = {}){
  const src = gltf.scene, inner = new THREE.Group(); inner.add(src); inner.rotation.y = -Math.PI / 2; inner.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), s = height / size.y;
  const mid = new THREE.Group(); mid.add(inner); mid.scale.setScalar(s); mid.position.set(-(box.min.x + box.max.x) / 2 * s, -box.min.y * s, -(box.min.z + box.max.z) / 2 * s);
  const outer = new THREE.Group(); outer.add(mid); outer.userData.size = size.multiplyScalar(s);
  src.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; const m = o.material;
    if (m && m.isMeshStandardMaterial){ m.envMapIntensity = 0.65; if (glow && m.map){ m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = glow; } if (caustic) patch(m); envMats.push(m); } });
  return outer;
}
/** invisible, cheap ray targets so hover/tap never tests 30k-triangle meshes */
function hitBox(parent, w, h, d, y = h / 2, x = 0, z = 0){ const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false })); m.position.set(x, y, z); parent.add(m); return m; }
function hitBall(parent, r, x, y, z){ const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ visible: false })); m.position.set(x, y, z); parent.add(m); return m; }

/* ---------- 深海萌物随宠: the five swim rings stay; the cats inside are Tripo models (refs 2–6) ---------- */
const petList = [];
function buildPets(){
  const S = 1.15, wy = 2.45, CH = 1.6;
  const spots = [[-14.5, 84, [[-1.55, 0.7], [1.55, -0.55]], 0.35], [14.5, 84, [[-1.7, 0.95], [1.75, 0.85], [0.05, -1.65]], -0.35]];
  let k = 0;
  for (const [px, pz, offs, ry] of spots) for (const [ox, oz] of offs){
    const def = PETS[k], g = new THREE.Group(), ring = buildRing(def), cat = new THREE.Group(); g.add(ring); g.add(cat);
    const model = fitTripo(T3['pet' + k], CH, { glow: 0.3, caustic: false }); model.position.y = -0.2; cat.add(model);   // seated down inside the ring
    const hit = hitBox(g, 2.1, CH + 0.3, 2.1, (CH + 0.3) / 2 - 0.3);
    g.scale.setScalar(S);
    const home = new THREE.Vector3(px + ox, wy + 0.1 * S, pz + oz); g.position.copy(home); g.rotation.y = ry + (k % 2 ? -0.15 : 0.15);
    g.userData = { cat, ring, head: new THREE.Vector3(0, CH + 0.25, 0), def }; scene.add(g);
    const p = { g, def, home, ry: g.rotation.y, ph: k * 1.37, jump: -1, idx: k };
    petList.push(p); interactives.push({ obj: hit, anchor: g, kind: 'pet', pet: p, label: `点击 · ${def.name}` });
    k++;
  }
}
function updatePets(dt, t){
  for (const p of petList){
    const { g, home } = p, c = g.userData.cat, rg = g.userData.ring;
    const drift = 0.32;
    g.position.set(home.x + Math.cos(t * 0.21 + p.ph) * drift, home.y + Math.sin(t * 1.3 + p.ph) * 0.05, home.z + Math.sin(t * 0.17 + p.ph * 1.3) * drift);
    g.rotation.y = p.ry + Math.sin(t * 0.33 + p.ph) * 0.18;
    rg.rotation.z = Math.sin(t * 1.1 + p.ph) * 0.035; rg.rotation.x = Math.cos(t * 0.9 + p.ph) * 0.035;
    if (p.jump >= 0){ p.jump += dt; const u = p.jump / 0.62;
      if (u >= 1){ p.jump = -1; c.position.y = 0; c.scale.set(1, 1, 1); }
      else { c.position.y = Math.sin(Math.PI * u) * 0.75; const sq = u < 0.12 ? 1 - u * 1.4 : u > 0.88 ? 1 - (1 - u) * 1.2 : 1 + 0.08 * Math.sin(Math.PI * u); c.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); } }
    else c.position.y = Math.sin(t * 2.1 + p.ph) * 0.02;
  }
}
const duckList = [];
function duckGeo(){
  const parts = [], col = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c); for (let i = 0; i < n; i++){ a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const sp = (r, ws, hs, sx, sy, sz, x, y, z, c, rx = 0) => { const g = new THREE.SphereGeometry(r, ws, hs); g.scale(sx, sy, sz); if (rx) g.rotateX(rx); g.translate(x, y, z); col(g, c); };
  sp(1, 26, 18, 0.34, 0.24, 0.44, 0, 0.12, -0.02, 0xffd21f);                 // body
  sp(1, 14, 10, 0.16, 0.14, 0.16, 0, 0.27, -0.4, 0xffd21f, -0.6);            // tail flick
  for (const s of [-1, 1]) sp(1, 14, 10, 0.06, 0.13, 0.24, s * 0.31, 0.17, -0.06, 0xffc400);   // wings
  sp(0.19, 24, 18, 1, 1, 1, 0, 0.46, 0.24, 0xffd21f);                        // head
  sp(1, 16, 10, 0.1, 0.035, 0.12, 0, 0.42, 0.45, 0xff8a1e);                  // beak
  sp(1, 12, 8, 0.085, 0.025, 0.1, 0, 0.385, 0.43, 0xff7414);
  for (const s of [-1, 1]){ sp(0.036, 10, 8, 1, 1.25, 1, s * 0.085, 0.52, 0.39, 0x161616); sp(0.012, 6, 5, 1, 1, 1, s * 0.078, 0.54, 0.418, 0xffffff); }
  sp(1, 10, 8, 0.05, 0.03, 0.02, 0.12, 0.44, 0.38, 0xffa0a0); sp(1, 10, 8, 0.05, 0.03, 0.02, -0.12, 0.44, 0.38, 0xffa0a0);   // blush
  return mergeGeometries(parts.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }));
}
function buildDucks(){
  const geo = duckGeo(), mat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.0, emissive: 0x332200, emissiveIntensity: 0.25 }), { caustic: false });
  const T = 8, wy = T + 0.46;
  let k = 0;
  for (const sx of [-1, 1]) for (const [ox, oz, s] of [[-3.0, -1.4, 1.15], [2.6, 1.6, 1.0], [0.3, -0.2, 1.3], [-1.6, 2.0, 0.9]]){
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.scale.setScalar(s); scene.add(m);
    const d = { m, cx: sx * 14 + ox * 0.6, cz: 26.3 + oz * 0.5, ax: 1.0 + 0.5 * (k % 3), az: 0.6 + 0.3 * (k % 2), sp: 0.12 + 0.05 * (k % 4), ph: k * 1.9, wy, hop: -1, k };
    duckList.push(d); interactives.push({ obj: m, kind: 'duck', duck: d, label: '点击 · 小黄鸭' }); k++;
  }
}
const _dv = new THREE.Vector3();
function updateDucks(dt, t){
  for (const d of duckList){
    const a = t * d.sp + d.ph, x = d.cx + Math.sin(a) * d.ax, z = d.cz + Math.sin(a * 2) * d.az * 0.5;
    const nx = d.cx + Math.sin(a + 0.05) * d.ax, nz = d.cz + Math.sin((a + 0.05) * 2) * d.az * 0.5;
    let y = d.wy - 0.04 + Math.sin(t * 2.2 + d.ph) * 0.03;
    if (d.hop >= 0){ d.hop += dt; const u = d.hop / 0.45; if (u >= 1) d.hop = -1; else y += Math.sin(Math.PI * u) * 0.45; }
    d.m.position.set(x, y, z); d.m.rotation.set(Math.sin(t * 1.7 + d.ph) * 0.06, Math.atan2(nx - x, nz - z), Math.cos(t * 1.3 + d.ph) * 0.06);
  }
}
function quack(d){ d.hop = 0; sfx.squeak(); sayBubble(d.m, new THREE.Vector3(0, 0.9, 0), '嘎！', 1.4); }
function greetPet(p){ p.jump = 0; sfx.boing(); sayBubble(p.g, p.g.userData.head, `你好，我是<b>${p.def.name}</b>`); }

/* ---------- Poseidon statue (ref 13) — Tripo model on the fountain ---------- */
function poseidon(x, y, z, h){
  const g = fitTripo(T3.poseidon, h, { glow: 0.1 });
  g.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial){ o.material.color.setRGB(1.32, 1.32, 1.36); o.material.roughness = 0.5; o.material.emissiveIntensity = 0.2; } });
  g.position.set(x, y, z); g.name = 'poseidon'; scene.add(g);
  const sz = g.userData.size, hit = hitBox(g, sz.x * 0.75, h, sz.z * 0.75);
  interactives.push({ obj: hit, anchor: g, kind: 'statue', label: '点击 · 海神波塞冬雕像' });
}

/* ---------- 秘密贝壳 (ref 8): three Tripo shells that open on a hinge and hand you a memory (refs 9–11) ---------- */
const SHELLS = [
  { key: 'shell0', name: '广场贝壳', at: [-4.6, 2, 101.6], ry: 0, img: 'photos/memory-1.jpg', title: '白玫瑰与水母', sub: '她抱着一束白玫瑰，说要送给第一个推开图书馆大门的人。' },
  { key: 'shell1', name: '楼梯口贝壳', at: [-3.4, 2, 53.6], ry: 0.11, img: 'photos/memory-2.jpg', title: '海边的车站', sub: '那天她在站牌下等一班不会来的船，小鱼一直陪着她。' },
  { key: 'shell2', name: '长廊贝壳', bridge: 0.22, img: 'photos/memory-3.jpg', title: '窗边的午后', sub: '她托着腮发呆——想的，是那个小小的、会陪她看书的自己。' },
];
const shellList = [];
/** split the Tripo shell into a lid and a base (triangles above / below the waist seam) */
function splitShell(gltf, H, seamFrac = 0.342){   // the groove between bowl and lid (mean-radius dip measured on the model)
  let mesh = null; gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  gltf.scene.updateMatrixWorld(true);
  const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2).multiply(mesh.matrixWorld), nm = new THREE.Matrix3().getNormalMatrix(m);
  const src = mesh.geometry, P = src.attributes.position, N = src.attributes.normal, UVa = src.attributes.uv, n = P.count, v = new THREE.Vector3();
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), box = new THREE.Box3();
  for (let i = 0; i < n; i++){ v.fromBufferAttribute(P, i).applyMatrix4(m); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; box.expandByPoint(v);
    if (N){ v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor[i * 3] = v.x; nor[i * 3 + 1] = v.y; nor[i * 3 + 2] = v.z; }
    if (UVa){ uv[i * 2] = UVa.getX(i); uv[i * 2 + 1] = UVa.getY(i); } }
  const s = H / (box.max.y - box.min.y), cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  for (let i = 0; i < n; i++){ pos[i * 3] = (pos[i * 3] - cx) * s; pos[i * 3 + 1] = (pos[i * 3 + 1] - box.min.y) * s; pos[i * 3 + 2] = (pos[i * 3 + 2] - cz) * s; }
  const seam = H * seamFrac, idx = src.index ? src.index.array : Array.from({ length: n }, (_, i) => i), top = [], bot = [];
  for (let t = 0; t < idx.length; t += 3){ const a = idx[t], b = idx[t + 1], c = idx[t + 2], cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3; (cy > seam ? top : bot).push(a, b, c); }
  let zBack = Infinity; for (let i = 0; i < n; i++) if (Math.abs(pos[i * 3 + 1] - seam) < H * 0.05) zBack = Math.min(zBack, pos[i * 3 + 2]);
  const mk = list => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (N) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); if (UVa) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(list); if (!N) g.computeVertexNormals(); g.computeBoundingSphere(); return g; };
  return { lid: mk(top), base: mk(bot), seam, zBack, size: new THREE.Vector3((box.max.x - box.min.x) * s, H, (box.max.z - box.min.z) * s), material: mesh.material };
}
function buildShells(){
  const H = 1.45, sp = splitShell(T3.shell, H), mat = sp.material;
  mat.envMapIntensity = 0.8; mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.22; mat.side = THREE.DoubleSide; patch(mat); envMats.push(mat);
  const pearlMat = new THREE.MeshPhysicalMaterial({ color: 0xfff6fb, roughness: 0.12, metalness: 0.0, iridescence: 1, iridescenceIOR: 1.5, clearcoat: 1, emissive: 0xffd8f0, emissiveIntensity: 0.4 });
  for (const d of SHELLS){
    let x, y, z, ry = d.ry;
    if (d.bridge != null){ const x0 = -33, z0 = 84.2, y0 = 2, x1 = -88.6, z1 = 18.2, y1 = 8, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz, nz = ux;
      x = x0 + (x1 - x0) * d.bridge + nx * 1.25; z = z0 + (z1 - z0) * d.bridge + nz * 1.25; y = y0 + (y1 - y0) * d.bridge + 0.05; ry = Math.atan2(-nx, -nz); }
    else [x, y, z] = d.at;
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; scene.add(g);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(sp.size.x * 0.56, sp.size.x * 0.62, 0.14, 40), mats.marble); ped.position.y = 0.07; ped.receiveShadow = ped.castShadow = true; g.add(ped);
    const body = new THREE.Group(); body.position.y = 0.14; g.add(body);
    const base = new THREE.Mesh(sp.base, mat); base.castShadow = base.receiveShadow = true; body.add(base);
    const hinge = new THREE.Group(); hinge.position.set(0, sp.seam, sp.zBack); body.add(hinge);
    const lid = new THREE.Mesh(sp.lid, mat); lid.position.set(0, -sp.seam, -sp.zBack); lid.castShadow = true; hinge.add(lid);
    const pearl = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), pearlMat); pearl.position.set(0, sp.seam - 0.05, 0.05); body.add(pearl);
    const glowL = new THREE.PointLight(0xffc8ec, 0, 6, 1.8); glowL.position.set(0, sp.seam + 0.25, 0.1); body.add(glowL);
    const spk = []; for (let k = 0; k < 40; k++) spk.push((Math.random() - 0.5) * 0.9, sp.seam + Math.random() * 1.4, (Math.random() - 0.5) * 0.7);
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(spk, 3));
    const spark = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffe2f6, size: 0.07, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); spark.frustumCulled = false; body.add(spark);
    const hit = hitBox(g, sp.size.x * 1.05, H + 0.4, sp.size.z * 1.05, (H + 0.4) / 2);
    const sh = { ...d, g, hinge, pearl, glowL, spark, t: 0, open: 0, pos: new THREE.Vector3(x, y, z), ry, H };
    shellList.push(sh); interactives.push({ obj: hit, anchor: g, kind: 'shell', shell: sh, label: `点击 · 打开${d.name}` });
    obst(x, z, sp.size.x * 0.62, y - 1, y + 2.2);
  }
}
function updateShells(dt, t){
  for (const s of shellList){
    s.t += (s.open - s.t) * Math.min(1, dt * (s.open ? 2.4 : 1.8)); const e = s.t * s.t * (3 - 2 * s.t);
    s.hinge.rotation.x = -1.2 * e;
    s.pearl.position.y = s.hinge.position.y - 0.05 + e * 0.18 + Math.sin(t * 2) * 0.02 * e; s.pearl.rotation.y = t * 0.6;
    s.glowL.intensity = e * 9; s.spark.material.opacity = e * 0.9;
    if (e > 0.01){ const a = s.spark.geometry.attributes.position.array; for (let i = 1; i < a.length; i += 3){ a[i] += dt * 0.35; if (a[i] > s.hinge.position.y + 1.5) a[i] = s.hinge.position.y; } s.spark.geometry.attributes.position.needsUpdate = true; }
  }
}

/* ---------- 猫糕小船 (ref 12): a Tripo boat with three 猫糕 moored on the right river ---------- */
const BOAT = { z: 22 }, boatCats = [
  { name: '谐乐小喵', nx: 0.0, ny: 0.79 },
  { name: '墨镜猫咪', nx: -0.16, ny: 0.4 },
  { name: '萤绒绒', nx: 0.12, ny: 0.4 },
];
const riverX = z => 69 + 6 * Math.sin(z * 0.03 + 1.3), riverY = z => chanFloor(z) + 3.4;
function buildBoat(){
  const g = fitTripo(T3.boat, 4.6, { glow: 0.28 }), sz = g.userData.size;
  const root = new THREE.Group(); root.add(g); scene.add(root);
  Object.assign(BOAT, { root, model: g, size: sz, ry: -0.55, rock: 0 });
  boatCats.forEach(c => { const hb = hitBall(g, sz.x * 0.13, c.nx * sz.x, c.ny * sz.y, sz.z * 0.08);
    c.anchor = hb; interactives.push({ obj: hb, anchor: hb, kind: 'boatcat', cat: c, label: `点击 · 和${c.name}打招呼` }); });
  const hull = hitBox(g, sz.x * 0.95, sz.y * 0.4, sz.z * 0.9, sz.y * 0.2);   // a tap on the hull greets the next 猫糕 in turn
  interactives.push({ obj: hull, anchor: hull, kind: 'boatcat', label: '点击 · 和猫糕们打招呼' });
  updateBoat(0, 0);
}
function updateBoat(dt, t){
  if (!BOAT.root) return;
  const z = BOAT.z + Math.sin(t * 0.045) * 3, x = riverX(z), y = riverY(z) - 0.32;   // midstream, below the east bridge
  BOAT.rock = Math.max(0, BOAT.rock - dt * 0.8);
  BOAT.root.position.set(x, y + Math.sin(t * 1.2) * 0.08 + Math.sin(BOAT.rock * 14) * 0.12 * BOAT.rock, z);
  BOAT.root.rotation.set(Math.sin(t * 0.9) * 0.025, BOAT.ry + Math.sin(t * 0.21) * 0.05, Math.sin(t * 1.1) * 0.035 + Math.sin(BOAT.rock * 12) * 0.06 * BOAT.rock);
}
function greetBoatCat(c){ BOAT.rock = 1; sfx.boing(); sayBubble(c.anchor, new THREE.Vector3(0, BOAT.size.x * 0.17, 0), `你好，我是<b>${c.name}</b>～`, 3); }

/* ---------- acropolis terrace T1 with pools and tholoi ---------- */
function buildT1(){
  const cx = 0, cz = -12, top = 8, r = 50;
  padC(cx, cz, r + 0.6, top, { drop: 4.6, slope: 0.5, range: 20 });
  diskPodium(cx, cz, r, top, -12, { pilasters: 56 });
  const aE = Math.atan2(46, 0), aW = Math.atan2(-46.5, 6.4);
  const gaps = [{ a: 0, h: 0.16 }, { a: aE, h: 0.075 }, { a: aW, h: 0.075 }, { a: Math.PI, h: 0.14 }];
  ringRailGaps(cx, cz, r - 0.15, top, gaps);
  for (const [a0, a1] of arcsFromGaps(gaps.map(g => ({ a: g.a, h: g.h + 0.05 })))){
    band('trim', cx, cz, 46.8, 47.2, top, top + 0.55, a0, a1); band('trim', cx, cz, 48.9, 49.25, top, top + 0.55, a0, a1);
    band('poolTile', cx, cz, 47.15, 48.95, top, top + 0.08, a0, a1);           // moat floor
    waterArc(cx, top + 0.44, cz, 47.18, 48.92, a0, a1);                       // blue water to the brim (ref 6 arrows)
  }
  const pGaps = arcsFromGaps(gaps.map(g => ({ a: g.a, h: g.h + 0.05 })));
  const planterHoles = pGaps.map(([a0, a1]) => ({ k: 'a', x: cx, z: cz, r0: 46.4, r1: 50, a0, a1 }));
  const holes = [{ k: 'r', x: 0, z: 13.9, hw: 7.0, hl: 6.5 }, { k: 'r', x: 0, z: -15, hw: 26.6, hl: 23.6 }, { k: 'r', x: -14, z: 26.3, hw: 5.9, hl: 4.0 }, { k: 'r', x: 14, z: 26.3, hw: 5.9, hl: 4.0 }, ...planterHoles];
  for (const sx of [-1, 1]){
    // reflecting pools
    const px = sx * 14, pz = 26.3;
    for (const [bx, bz, bw, bd] of [[px, pz - 3.6, 11.4, 0.4], [px, pz + 3.6, 11.4, 0.4], [px - 5.5, pz, 0.4, 7.6], [px + 5.5, pz, 0.4, 7.6]]) boxB('trim', bx, top, bz, bw, 0.6, bd);
    boxB('poolTile', px, top, pz, 10.6, 0.12, 6.8); waterRect(px, top + 0.46, pz, 10.6, 6.8);
    lampPost(sx * 7.6, top, 24.2, 3.2); lampPost(sx * 7.6, top, 34.6, 3.2);
    // tholoi (图1 round temples)
    tholos(sx * 28, top, 16, 5.4, true); zoneDisk(sx * 28, 16, 5.6, top + 0.6);
    for (const [ppx, ppz] of [[sx * 38, 2], [sx * 38, -26], [sx * 30, -44]]) planterRing(ppx, top, ppz, 2.3);
  }
  PL.push([0, 13, 30]);
  zoneDisk(cx, cz, 49.3, top, holes);
  stairs(0, 20.2, 8, 0, 7.6, 14, 12, { lampLift: 1.0 });
  stairs(0, -61, 8, 0, -70.6, 12, 12, { lampLift: 1.0 });
}

/* ---------- central sanctum (图1) on podium T2 ---------- */
function buildPalace(){
  const T = 14;
  padR(0, -15, 26, 23, T, null);
  boxB('shade', 0, -12, -15, 52, 25.3, 46);
  boxB('trim', 0, T - 0.7, -15, 53.2, 0.7, 47.2);
  // podium pilasters + glowing lower windows
  for (let x = -24; x <= 24.01; x += 4){ if (Math.abs(x) > 6.9){ boxB('trim', x, 7.5, 8.15, 0.7, 5.8, 0.4); } boxB('trim', x, 7.5, -38.15, 0.7, 5.8, 0.4); }
  for (let zz = -36; zz <= 6.01; zz += 4){ boxB('trim', 26.15, 7.5, zz, 0.4, 5.8, 0.7); boxB('trim', -26.15, 7.5, zz, 0.4, 5.8, 0.7); }
  for (let x = -22; x <= 22.01; x += 4){ if (Math.abs(x) > 7) win(x, 8.9, 8.0, 0, 1.3, 3.0); win(x, 8.9, -38.0, Math.PI, 1.3, 3.0); }
  for (let zz = -34; zz <= 4.01; zz += 4){ win(26.0, 8.9, zz, Math.PI / 2, 1.3, 3.0); win(-26.0, 8.9, zz, -Math.PI / 2, 1.3, 3.0); }
  lineRail(-25.7, 7.7, T, -6.5, 7.7, T); lineRail(6.5, 7.7, T, 25.7, 7.7, T);
  lineRail(-25.7, 7.7, T, -25.7, -37.7, T); lineRail(25.7, 7.7, T, 25.7, -37.7, T); lineRail(-25.7, -37.7, T, 25.7, -37.7, T);
  // main block
  const mz = -17, mw = 32, md = 28, mh = 18;
  boxB('marble', 0, T, mz - md / 2 + 0.5, mw, mh, 1);
  for (const sx of [-1, 1]) boxB('marble', sx * (mw / 2 - 0.5), T, mz, 1, mh, md - 2);
  { const fw = new THREE.Shape([new THREE.Vector2(-mw / 2, 0), new THREE.Vector2(mw / 2, 0), new THREE.Vector2(mw / 2, mh), new THREE.Vector2(-mw / 2, mh)]);
    fw.holes.push(archPath(new THREE.Path(), 5.2, 8.6, 0.65)); put('marble', new THREE.ExtrudeGeometry(fw, { depth: 1, bevelEnabled: false, curveSegments: 20 }), TM(0, T, mz + md / 2 - 1)); }
  const rimBand = (y0, h, out) => { boxB('trim', 0, y0, mz + md / 2 + out / 2 - 0.05, mw + out * 2, h, out + 0.1); boxB('trim', 0, y0, mz - md / 2 - out / 2 + 0.05, mw + out * 2, h, out + 0.1);
    for (const sx of [-1, 1]) boxB('trim', sx * (mw / 2 + out / 2 - 0.05), y0, mz, out + 0.1, h, md); };
  rimBand(T, 0.8, 0.4); rimBand(T + 8.2, 0.5, 0.25); rimBand(T + mh - 0.9, 0.9, 0.7);
  for (let x = -15.5; x <= 15.51; x += 3.875){ if (Math.abs(x) > 0.1) boxB('trim', x, T + 0.8, mz + md / 2 + 0.15, 0.7, mh - 1.7, 0.4); boxB('trim', x, T + 0.8, mz - md / 2 - 0.15, 0.7, mh - 1.7, 0.4); }
  for (let zz = mz - 12.5; zz <= mz + 12.51; zz += 3.57){ boxB('trim', mw / 2 + 0.15, T + 0.8, zz, 0.4, mh - 1.7, 0.7); boxB('trim', -mw / 2 - 0.15, T + 0.8, zz, 0.4, mh - 1.7, 0.7); }
  for (const yy of [T + 1.6, T + 9.6]){
    for (const x of [-13.6, -9.7, 9.7, 13.6]) win(x, yy, mz + md / 2, 0, 1.6, 4.6);
    for (const x of [-13.6, -9.7, -5.8, -1.9, 1.9, 5.8, 9.7, 13.6]) win(x, yy, mz - md / 2, Math.PI, 1.6, 4.6);
  }
  for (const zz of [-27.6, -24, -20.4, -16.8, -13.2, -9.6, -6]){ win(mw / 2, T + 10.6, zz, Math.PI / 2, 1.5, 4.0); win(-mw / 2, T + 10.6, zz, -Math.PI / 2, 1.5, 4.0); }
  win(-5.8, T + 1.6, mz + md / 2, 0, 1.5, 4.4); win(5.8, T + 1.6, mz + md / 2, 0, 1.5, 4.4);
  win(0, T + 9.8, mz + md / 2, 0, 2.0, 4.4); win(-5.8, T + 9.8, mz + md / 2, 0, 1.5, 4.4); win(5.8, T + 9.8, mz + md / 2, 0, 1.5, 4.4);
  buildLibrary(T, mz);
  const roof = T + mh;
  lineRail(-15.6, mz + 13.6, roof, 15.6, mz + 13.6, roof); lineRail(-15.6, mz - 13.6, roof, 15.6, mz - 13.6, roof);
  lineRail(15.6, mz - 13.6, roof, 15.6, mz + 13.6, roof); lineRail(-15.6, mz - 13.6, roof, -15.6, mz + 13.6, roof);
  // portico with pediment
  const pz = mz + md / 2;
  boxB('trim', 0, T, pz + 3.4, 22.6, 0.35, 7.2); boxB('marble', 0, T + 0.35, pz + 3.3, 21.6, 0.3, 6.8);
  const pcH = 10.4;
  for (const zz of [pz + 5.8, pz + 2.4]) for (let i = 0; i < 6; i++){ const cxp = -8.75 + i * 3.5; if (Math.abs(cxp) < 2.5) continue; column(cxp, T + 0.65, zz, pcH, 0.62, true); }
  boxB('trim', 0, T + 0.65 + pcH, pz + 3.3, 21.4, 1.5, 7.4);
  boxB('marble', 0, T + 0.65 + pcH + 1.5, pz + 3.3, 21.0, 0.6, 7.0);
  const pedY = T + 0.65 + pcH + 2.1, pw = 21.4, ph = 4.4;
  const tri = new THREE.Shape(); tri.moveTo(-pw / 2, 0); tri.lineTo(pw / 2, 0); tri.lineTo(0, ph); tri.closePath();
  const tg = new THREE.ExtrudeGeometry(tri, { depth: 7.0, bevelEnabled: false }); tg.translate(0, 0, -3.5);
  put('marble', tg, TM(0, pedY, pz + 3.3));
  const ra = Math.atan2(ph, pw / 2), rl = Math.hypot(pw / 2, ph) + 0.8;
  put('trim', GBOX, TM(-pw / 4, pedY + ph / 2 + 0.15, pz + 3.3, 0, rl, 0.55, 7.6, 0, ra));
  put('trim', GBOX, TM(pw / 4, pedY + ph / 2 + 0.15, pz + 3.3, 0, rl, 0.55, 7.6, 0, -ra));
  put('gold', cylGeo(1.25, 1.25, 0.16, 32), TM(0, pedY + ph * 0.36, pz + 6.85, 0, 1, 1, 1, Math.PI / 2));
  put('gold', sphGeo(0.4, 10, 8), TM(0, pedY + ph + 0.4, pz + 3.3));
  for (const sx of [-1, 1]) put('gold', sphGeo(0.32, 10, 8), TM(sx * pw / 2, pedY + 0.4, pz + 6.4));
  PL.push([0, T + 5, pz + 8.5]);
  // side wings with small domes (图1)
  for (const sx of [-1, 1]){
    const wx = sx * 19.5;
    boxB('marble', wx, T, -18, 7, 10, 22); boxB('trim', wx, T + 9.3, -18, 7.8, 0.7, 22.8);
    boxWins(wx, -18, 7, 22, T + 1.6, 2, 5, 1.3, 3.6, sx > 0 ? 'nse' : 'nsw');
    lineRail(wx - 3.2 * sx, -7.4, T + 10, wx + 3.2 * sx, -7.4, T + 10);
    domeAsm(wx, T + 10, -12, 2.9, { drumH: 2.4, cols: 8, lobes: 10 });
    domeAsm(wx, T + 10, -24, 2.9, { drumH: 2.4, cols: 8, lobes: 10 });
  }
  // roof pavilions
  for (const [x, zz] of [[-12.4, mz + 10.4], [12.4, mz + 10.4], [-12.4, mz - 10.4], [12.4, mz - 10.4]]){
    boxB('marble', x, roof, zz, 4.6, 3.2, 4.6); boxB('trim', x, roof + 3.2, zz, 5.2, 0.4, 5.2); boxWins(x, zz, 4.6, 4.6, roof + 0.6, 1, 1, 1.0, 2.2);
    domeAsm(x, roof + 3.6, zz, 2.2, { drumH: 1.6, cols: 8, lobes: 10 });
  }
  // central drum + great dome (city's tallest landmark)
  boxB('marble', 0, roof, mz, 19, 1.4, 19); boxB('trim', 0, roof + 1.4, mz, 19.8, 0.4, 19.8);
  domeAsm(0, roof + 1.8, mz, 9.6, { drumH: 7.6, cols: 20, hs: 1.16, lobes: 16, spire: 9.5 });
  // flanking clock towers + rear tower
  for (const sx of [-1, 1]) squareTower(sx * 21, T, 1.2, 6.4, 20, { top: 'spire', clock: true, spireH: 9.5 });
  squareTower(0, T, -34.2, 7, 17, { top: 'dome', clock: true });
  const ph2 = [{ k: 'r', x: 0, z: mz, hw: 16.7, hl: 14.7 }, { k: 'r', x: 19.5, z: -18, hw: 4.2, hl: 11.7 }, { k: 'r', x: -19.5, z: -18, hw: 4.2, hl: 11.7 },
    { k: 'r', x: 21, z: 1.2, hw: 3.9, hl: 3.9 }, { k: 'r', x: -21, z: 1.2, hw: 3.9, hl: 3.9 }, { k: 'r', x: 0, z: -34.2, hw: 4.2, hl: 4.2 }];
  zoneRect(0, -15, 25.3, 22.4, T, ph2);
  zoneRect(0, pz + 3.65, 10.6, 3.05, T + 0.65);
}

/* ---------- skyline district (图3) ---------- */
function buildDistrict(){
  const top = 12, cz = -90;
  padR(0, cz, 58, 24, top, { drop: 3.4, slope: 0.6, range: 18 });
  boxB('shade', 0, -10, cz, 116, top - 0.7 + 10, 48); boxB('trim', 0, top - 0.7, cz, 117, 0.7, 49);
  for (let x = -56; x <= 56.01; x += 4) boxB('trim', x, -2, -65.85, 0.7, top - 0.7 + 2, 0.4);
  for (let x = -54; x <= 54.01; x += 4) if (Math.abs(x) > 7) win(x, top - 5.2, -66.0, 0, 1.2, 3.2);
  lineRail(-57.6, -66.4, top, -6.4, -66.4, top); lineRail(6.4, -66.4, top, 53.5, -66.4, top);
  lineRail(-57.6, -66.4, top, -57.6, -113.6, top); lineRail(57.6, -71, top, 57.6, -113.6, top); lineRail(-57.6, -113.6, top, 57.6, -113.6, top);
  const holes = [];
  // front gallery (arcade facing the sanctum)
  for (const [x0, x1] of [[-52, -8], [8, 50]]){
    const n = Math.round((x1 - x0) / 3.4);
    for (let i = 0; i <= n; i++){ const x = mix(x0, x1, i / n); column(x, top, -68.4, 6, 0.45, true); column(x, top, -72.2, 6, 0.45, true); }
    boxB('trim', (x0 + x1) / 2, top + 6, -70.3, x1 - x0 + 1.4, 0.9, 5.2); boxB('marble', (x0 + x1) / 2, top + 6.9, -70.3, x1 - x0 + 1.6, 0.45, 5.5);
    lineRail(x0 - 0.6, -67.8, top + 7.35, x1 + 0.6, -67.8, top + 7.35);
    for (let i = 0; i < n; i += 2) hangLamp(mix(x0, x1, (i + 0.5) / n), top + 4.6, -70.3);
  }
  PL.push([0, top + 4, -72]);
  const G = [[-42, -86, 4.6, 22, 14], [44, -88, 4.3, 21, 13], [-20, -104, 3.8, 20, 12], [22, -106, 4.0, 21, 12], [0, -102, 5.0, 23, 15]];
  for (const [x, z, r, H, sp] of G){ band('trim', x, z, 0, r + 0.9, top, top + 0.5); gothicTower(x, top + 0.5, z, r, H, sp); holes.push({ k: 'c', x, z, r: r + 1.6 }); }
  const S = [[-52, -104, 6, 16, 'dome'], [52, -104, 6, 15, 'dome'], [-26, -82, 5.4, 12, 'spire'], [28, -82, 5.4, 12, 'spire']];
  for (const [x, z, w, H, t] of S){ squareTower(x, top, z, w, H, { top: t, clock: t === 'dome', spireH: w * 1.5 }); holes.push({ k: 'r', x, z, hw: w / 2 + 1.2, hl: w / 2 + 1.2 }); }
  // terraced blocks
  for (const [x, z, w, d] of [[-36, -98, 13, 10], [35, -100, 12, 11], [-9, -88, 10, 8], [10, -90, 9, 8]]){
    let yy = top, ww = w, dd = d;
    for (let t = 0; t < 3; t++){
      const h = 5.2 - t * 0.6;
      boxB(t % 2 ? 'shade' : 'marble', x, yy, z, ww, h, dd); boxB('trim', x, yy + h, z, ww + 0.6, 0.45, dd + 0.6);
      boxWins(x, z, ww, dd, yy + 0.8, Math.max(1, Math.round(ww / 3)), Math.max(1, Math.round(dd / 3)), 1.0, h * 0.5);
      yy += h + 0.45; ww *= 0.74; dd *= 0.74;
    }
    domeAsm(x, yy, z, Math.min(ww, dd) * 0.42, { drumH: 1.4, cols: 8, lobes: 10 });
    holes.push({ k: 'r', x, z, hw: w / 2 + 0.7, hl: d / 2 + 0.7 });
  }
  for (const [x, z] of [[-14, -76], [14, -76], [-40, -76], [40, -76]]) lampPost(x, top, z, 3.2);
  holes.push({ k: 'r', x: 0, z: -68.4, hw: 7.0, hl: 2.0 });
  zoneRect(0, cz, 57.2, 23.2, top, holes);
}

/* ---------- side wings, aqueduct bridges (图4) ---------- */
function rotunda(x, y, z, r){
  band('trim', x, z, 0, r + 0.7, y, y + 0.6);
  cyl('shade', x, y + 0.6, z, r, 8.4, 72);
  const n = 20;
  for (let i = 0; i < n; i++){ const a = i * TAU / n; column(x + (r + 0.25) * Math.sin(a), y + 0.6, z + (r + 0.25) * Math.cos(a), 8.0, 0.42); }
  ringWins(x, z, r + 0.02, y + 1.6, n, 1.5, 5.2, Math.PI / n);
  band('trim', x, z, 0, r + 0.9, y + 8.6, y + 9.6);
  ringRail(x, z, r + 0.4, y + 9.6, 0, TAU);
  const r2 = r * 0.84;
  cyl('marble', x, y + 9.6, z, r2 * 0.8, 6.4, 64);
  ringWins(x, z, r2 * 0.8 + 0.02, y + 10.5, 14, 1.2, 3.8, 0.2);
  for (let i = 0; i < 18; i++){ const a = i * TAU / 18; column(x + r2 * Math.sin(a), y + 9.6, z + r2 * Math.cos(a), 6.0, 0.36); }
  band('trim', x, z, 0, r2 + 0.5, y + 15.6, y + 16.4);
  return domeAsm(x, y + 16.4, z, r2 * 0.74, { drumH: 3.4, cols: 14, hs: 1.12, lobes: 14 });
}
function tieredDrum(x, y, z){
  band('trim', x, z, 0, 17.2, y, y + 0.6);
  let yb = y + 0.6;
  for (const [r, h] of [[16, 6], [12.6, 5.6], [9.4, 5.2]]){
    cyl('shade', x, yb, z, r * 0.8, h, 72);
    ringWins(x, z, r * 0.8 + 0.02, yb + 0.9, Math.round(r * 1.4), 1.2, h * 0.58, 0.1);
    const n = Math.round(r * 2.1);
    for (let i = 0; i < n; i++){ const a = i * TAU / n; column(x + (r - 0.6) * Math.sin(a), yb, z + (r - 0.6) * Math.cos(a), h - 0.8, 0.36); }
    band('trim', x, z, r * 0.78, r + 0.1, yb + h - 0.8, yb + h);
    band('marble', x, z, 0, r + 0.35, yb + h, yb + h + 0.5);
    ringRail(x, z, r, yb + h + 0.5, 0, TAU);
    for (let i = 0; i < 6; i++){ const a = i * TAU / 6 + 0.3; plantCluster(x + (r - 1.4) * Math.sin(a), yb + h + 0.5, z + (r - 1.4) * Math.cos(a), 1.0, 5); }
    yb += h + 0.5;
  }
  return domeAsm(x, yb, z, 7.4, { drumH: 3.0, cols: 12, hs: 1.1, lobes: 12 });
}
function buildWings(){
  // east wing: rotunda + slender spire (图4 right)
  const ex = 104, ez = -12, top = 8;
  padC(ex, ez, 21.6, top, { drop: 3.2, slope: 1.0, range: 18 });
  diskPodium(ex, ez, 21, top, -16);
  ringRailGaps(ex, ez, 20.8, top, [{ a: Math.atan2(85 - ex, -12 - ez), h: 0.17 }, { a: Math.atan2(92 - ex, -26.5 - ez), h: 0.15 }]);
  rotunda(ex, top, ez, 12.6);
  const st = [ex + 16.8 * Math.sin(2.4), ez + 16.8 * Math.cos(2.4)];
  squareTower(st[0], top, st[1], 4.8, 22, { top: 'spire', clock: false, spireH: 9 });
  zoneDisk(ex, ez, 20.2, top, [{ k: 'c', x: ex, z: ez, r: 13.9 }, { k: 'r', x: st[0], z: st[1], hw: 3.6, hl: 3.6 }]);
  PL.push([ex - 16, top + 4, ez + 4]);
  // west wing: tiered drum with gothic spires (图2/图4 left)
  const wx = -102, wz = 2;
  padC(wx, wz, 23.6, top, { drop: 3.2, slope: 1.0, range: 18 });
  diskPodium(wx, wz, 23, top, -16);
  ringRailGaps(wx, wz, 22.8, top, [{ a: Math.atan2(-81 - wx, -1 - wz), h: 0.16 }, { a: Math.atan2(-88.6 - wx, 18.2 - wz), h: 0.14 }]);
  tieredDrum(wx, top, wz);
  const gh = [];
  for (const a of [-135, -60, 180].map(d => d * Math.PI / 180)){ const gx = wx + 20 * Math.sin(a), gz = wz + 20 * Math.cos(a); band('trim', gx, gz, 0, 3.6, top, top + 0.4); gothicTower(gx, top + 0.4, gz, 2.7, 18, 10); gh.push({ k: 'c', x: gx, z: gz, r: 4.0 }); }
  zoneDisk(wx, wz, 22.2, top, [{ k: 'c', x: wx, z: wz, r: 17.8 }, ...gh]);
  PL.push([wx + 18, top + 4, wz + 6]);
  // aqueduct bridges (图4)
  bridge(46.5, -12, 8, 85.5, -12, 8, 6.2);
  bridge(-46.6, -5.6, 8, -81.2, -1.0, 8, 6.2);
  bridge(92.5, -27.0, 8, 52.5, -73.4, 12, 5.4);
  bridge(-33.0, 84.2, 2, -88.6, 18.2, 8, 5.4);
  bridge(33.0, 84.2, 2, 89.6, 93.6, 2, 5.0, { p1: 9.5 });
  PL.push([66, 11.5, -12]); PL.push([-64, 11.5, -3.5]);
  // east lookout tower on its reef pillar
  const lx = 100, lz = 96;
  padC(lx, lz, 11.4, 2, { drop: 2.4, slope: 0.9, range: 14 });
  diskPodium(lx, lz, 11, 2, -18, { pilasters: 14 });
  ringRailGaps(lx, lz, 10.8, 2, [{ a: Math.atan2(89.6 - lx, 93.6 - lz), h: 0.3 }]);
  squareTower(lx + 2.5, 2, lz + 2.5, 7, 22, { top: 'dome', clock: true });
  zoneDisk(lx, lz, 10.2, 2, [{ k: 'r', x: lx + 2.5, z: lz + 2.5, hw: 4.5, hl: 4.5 }]);
}

/* =====================================================================
   7. Terrain: irregular reef bed with chasms, ledges and buried podium bases
   ===================================================================== */
/** terrace the height into flat rock shelves separated by steeper broken faces */
function shelves(h, step, amt){ const q = Math.floor(h / step) * step; const f = (h - q) / step; return mix(h, q + smooth(0.2, 0.8, f) * step, amt); }
/** the seabed beyond the city: rolling reef ridges and outcrops that sink slowly into the deep */
function outerH(x, z){
  const d = Math.hypot(x / 1.15, z - 5);
  const h = -15 + fbm(x * 0.007 + 11.0, z * 0.007 - 4.0, 4) * 18 + (ridge(x * 0.016 + 3.0, z * 0.016, 4) - 0.55) * 22 - smooth(220, 900, d) * 26;
  return shelves(h, 4.0, 0.55);
}
function chanFloor(z){ return -9.6 + smooth(-46, -150, z) * 14 + 1.1 * Math.sin(z * 0.021); }
function natural(x, z){
  let h = -1.4 + fbm(x * 0.010 + 3.1, z * 0.010 - 1.7, 5) * 6.5 + (ridge(x * 0.028, z * 0.028, 4) - 0.5) * 6.5;
  h = shelves(h, 2.6, 0.6);
  h += smooth(-46, -150, z) * 14;
  const side = x > 0 ? 1.3 : 0.2;
  const cx = Math.abs(x) - 69 - 6 * Math.sin(z * 0.03 + side);
  const floorY = chanFloor(z), bankK = smooth(5, 17, Math.abs(cx));
  if (h > floorY) h = floorY + (h - floorY) * bankK;
  const ang = Math.atan2(x, z - 5), rr = Math.hypot(x / 1.15, z - 5);
  const Rd = 150 + 26 * vnoise(Math.cos(ang) * 1.6 + 4.0, Math.sin(ang) * 1.6 - 2.0) + 12 * vnoise(Math.cos(ang) * 4 + 1, Math.sin(ang) * 4 + 3);
  const cliff = smooth(-6, 46, rr - Rd);
  let hc = mix(h, outerH(x, z), cliff);
  const q = Math.floor(hc / 4.2) * 4.2;
  hc = mix(hc, q + (hc - q) * 0.25, clamp(cliff * (1 - cliff) * 2.8, 0, 0.7));
  return hc;
}
function terrainH(x, z){
  let h = natural(x, z);
  for (const p of pads){
    if (!p.sk) continue;
    const d = sdf(p, x, z);
    if (d > 0 && d < p.sk.range){
      const cdx = Math.abs(Math.abs(x) - 69 - 6 * Math.sin(z * 0.03 + (x > 0 ? 1.3 : 0.2)));
      const w = (1 - smooth(0, p.sk.range, d)) * smooth(7, 16, cdx);
      const sk = p.top - p.sk.drop - d * p.sk.slope + fbm(x * 0.09, z * 0.09, 2) * 1.8;
      if (sk > h) h = mix(h, sk, w);
    }
  }
  for (const p of pads){ const d = sdf(p, x, z); if (d < 1.2) h = Math.min(h, p.top - 0.55); }
  return h;
}
function buildTerrain(){
  const S = 660, N = 380;
  const g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2); g.translate(0, 0, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, terrainH(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const nrm = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const deep = new THREE.Color(0x2a4250), cliffC = new THREE.Color(0x2f4a56), bank = new THREE.Color(0x4a8c88), moss = new THREE.Color(0x3c7a70), sand = new THREE.Color(0x86a49a), teal = new THREE.Color(0x3a6676);
  for (let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = nrm.getY(i);
    const n1 = fbm(x * 0.06, z * 0.06, 3), n2 = vnoise(x * 0.2 + 7, z * 0.2 - 3);
    c.copy(teal).lerp(cliffC, smooth(0.86, 0.5, ny));
    c.lerp(moss, clamp(smooth(0.8, 0.97, ny) * (0.35 + n1 * 0.9), 0, 0.85));
    c.lerp(sand, clamp(smooth(0.93, 0.99, ny) * smooth(0.1, 0.6, n2) * 0.6, 0, 0.6));
    { const bx = Math.abs(Math.abs(x) - 69 - 6 * Math.sin(z * 0.03 + (x > 0 ? 1.3 : 0.2))); const nearBank = (1 - smooth(8, 20, bx)) * smooth(-150, -130, z) * (1 - smooth(150, 166, z));
      c.lerp(bank, nearBank * (0.55 + 0.35 * n1)); }
    c.lerp(deep, smooth(-8, -40, y) * 0.7);
    c.multiplyScalar(0.86 + n2 * 0.12);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, mats.rock); m.name = 'terrain'; m.receiveShadow = true; m.castShadow = true; scene.add(m);
  // far seabed
  const fg = new THREE.PlaneGeometry(3300, 3300, 150, 150); fg.rotateX(-Math.PI / 2);
  const fp = fg.attributes.position, fc = new Float32Array(fp.count * 3);
  for (let i = 0; i < fp.count; i++){
    const x = fp.getX(i), z = fp.getZ(i);
    const inside = Math.max(Math.abs(x), Math.abs(z - 8)) < 318;
    fp.setY(i, outerH(x, z) - 0.8 - (inside ? 12 : 0));
    c.copy(deep).lerp(sand, 0.18 + 0.15 * vnoise(x * 0.01, z * 0.01)); fc[i * 3] = c.r; fc[i * 3 + 1] = c.g; fc[i * 3 + 2] = c.b;
  }
  fg.computeVertexNormals(); fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
  const fm = new THREE.Mesh(fg, mats.rock); fm.name = 'seabed'; fm.receiveShadow = true; scene.add(fm);
}

/* =====================================================================
   8. Reef life: seaweed, corals, anemones, glow plants, boulders, kelp
   ===================================================================== */
const PAL = {
  weed: [0x7b45b8, 0x9a52c8, 0x3fae7a, 0x2fb6a2, 0xc8508e, 0x5fc06a, 0x6a3fa8, 0xd0703a, 0x58c9a8, 0xe0a040].map(h => new THREE.Color(h)),
  coral: [0xff6a3d, 0xff4f6d, 0xff9a3c, 0xffd23f, 0xc45ae6, 0xff7ac8, 0x5fd6c6, 0x7f8cff, 0xff8f70, 0x9be15d, 0xf25f8a, 0xffb347].map(h => new THREE.Color(h)),
  tube: [0xff6a2a, 0xe8452f, 0xff9a3c, 0xb05ae0, 0xf0b030, 0xe85a9a].map(h => new THREE.Color(h)),
  anem: [0xff6fc8, 0xd46cf0, 0xff8fb0, 0xb07cff, 0xff9a6a, 0x7fe0d0].map(h => new THREE.Color(h)),
  brain: [0xffd84a, 0xf2c23a, 0xb8e05a, 0xd0a8ff, 0xffb070, 0x8fd8c8].map(h => new THREE.Color(h)),
  glow: [0x7ff6ff, 0xff8fe0, 0xb5ff9a, 0xffe08a, 0x9fb8ff].map(h => new THREE.Color(h)),
  rock: [0x3a5562, 0x2f4652, 0x456472, 0x385a5c].map(h => new THREE.Color(h)),
};
const clearSpots = [];      // keep-clear circles (booth, swing)
const tornadoes = [];
function plantOne(x, y, z, scale = 1){
  const roll = rand(), r = R(0, TAU);
  if (roll < 0.3){ const h = R(0.9, 2.6) * scale; plantLists.weed.push({ x, y, z, r, sx: R(0.5, 0.9) * scale, sy: h, sz: R(0.5, 0.9) * scale, c: pick(PAL.weed) }); }
  else if (roll < 0.48) plantLists['coral' + (1 + Math.floor(rand() * 3))].push({ x, y, z, r, s: R(0.9, 1.7) * scale, c: pick(PAL.coral) });
  else if (roll < 0.58) plantLists.tube.push({ x, y, z, r, s: R(0.7, 1.3) * scale, c: pick(PAL.tube) });
  else if (roll < 0.68) plantLists.brain.push({ x, y: y - 0.1, z, r, s: R(0.5, 1.0) * scale, c: pick(PAL.brain) });
  else if (roll < 0.76) plantLists.fan.push({ x, y, z, r, s: R(0.9, 1.6) * scale, c: pick(PAL.coral) });
  else if (roll < 0.88) plantLists.anem.push({ x, y, z, r, s: R(0.6, 1.1) * scale, c: pick(PAL.anem) });
  else if (roll < 0.93) plantLists.table.push({ x, y, z, r, s: R(0.6, 1.1) * scale, c: pick(PAL.coral) });
  else plantLists.glow.push({ x, y, z, r, s: R(0.6, 1.2) * scale, c: pick(PAL.glow) });
}
function plantCluster(x, y, z, rad, n){ for (let i = 0; i < n; i++){ const a = rand() * TAU, d = Math.sqrt(rand()) * rad; plantOne(x + Math.sin(a) * d, y, z + Math.cos(a) * d, 0.75); } }
function scatterReef(){
  for (let i = 0, N = LOW ? 5500 : 15000; i < N; i++){
    const x = R(-200, 200), z = R(-150, 178);
    let dmin = 1e9; for (const p of pads){ const d = sdf(p, x, z); if (d < dmin) dmin = d; }
    if (dmin < 1.3) continue;
    if (clearSpots.some(c => Math.hypot(x - c[0], z - c[1]) < c[2])) continue;
    if (Math.abs(x) < 8.5 && z > 112 && z < 150) continue;          // front stairs + landing steps stay clear
    const near = dmin < 15, fore = z > 116;
    const patchy = smooth(-0.15, 0.35, fbm(x * 0.022 + 5.0, z * 0.022 - 2.0, 3));
    if (rand() > (near ? 0.85 : fore ? 0.48 : 0.2) * (0.12 + 0.88 * patchy)) continue;
    const y = terrainH(x, z); if (y < -34) continue;
    const roll = rand(), r = R(0, TAU);
    if (roll < 0.34){ const h = R(1.8, near ? 5.2 : 6.5) * (rand() < 0.1 ? 1.5 : 1); plantLists.weed.push({ x, y: y - 0.2, z, r, sx: R(0.8, 1.5), sy: h, sz: R(0.8, 1.5), c: pick(PAL.weed) }); }
    else if (roll < 0.5) plantLists['coral' + (1 + Math.floor(rand() * 3))].push({ x, y: y - 0.2, z, r, s: R(1.3, 3.0), c: pick(PAL.coral) });
    else if (roll < 0.58) plantLists.tube.push({ x, y: y - 0.15, z, r, s: R(1.0, 2.2), c: pick(PAL.tube) });
    else if (roll < 0.68) plantLists.brain.push({ x, y: y - 0.3, z, r, s: R(0.9, 2.0), c: pick(PAL.brain) });
    else if (roll < 0.75) plantLists.fan.push({ x, y: y - 0.2, z, r, s: R(1.4, 3.0), c: pick(PAL.coral) });
    else if (roll < 0.84) plantLists.anem.push({ x, y: y - 0.1, z, r, s: R(0.9, 1.7), c: pick(PAL.anem) });
    else if (roll < 0.89) plantLists.table.push({ x, y: y - 0.1, z, r, s: R(1.0, 2.0), c: pick(PAL.coral) });
    else if (roll < 0.94) plantLists.glow.push({ x, y: y - 0.1, z, r, s: R(0.9, 1.8), c: pick(PAL.glow) });
    else { const s = R(1.2, near ? 4.2 : 6.0); plantLists.boulder.push({ x, y: y - s * 0.35, z, r, sx: s * R(0.8, 1.3), sy: s * R(0.6, 1.0), sz: s * R(0.8, 1.3), rx: R(-0.3, 0.3), c: pick(PAL.rock) }); }
  }
  for (let i = 0; i < 160; i++){
    const x = R(-260, 260), z = R(-230, 250);
    let dmin = 1e9; for (const p of pads){ const d = sdf(p, x, z); if (d < dmin) dmin = d; }
    if (dmin < 9 || (Math.abs(x) < 60 && z > 60 && z < 200 && dmin < 20)) continue;
    if (clearSpots.some(c => Math.hypot(x - c[0], z - c[1]) < c[2] + 8)) continue;
    const y = terrainH(x, z), s = R(5, 13);
    plantLists.boulder.push({ x, y: y - s * 0.45, z, r: R(0, TAU), sx: s * R(0.7, 1.4), sy: s * R(0.5, 1.1), sz: s * R(0.7, 1.4), rx: R(-0.25, 0.25), c: pick(PAL.rock) });
  }
  for (let i = 0; i < 70; i++){
    const a = R(0, TAU), rr = R(150, 178);
    const x = Math.sin(a) * rr * 1.12, z = 5 + Math.cos(a) * rr;
    if (z > 120 && Math.abs(x) < 70) continue;
    const y = terrainH(x, z); if (y < -40) continue;
    plantLists.kelp.push({ x, y: y - 0.3, z, r: R(0, TAU), sx: R(2.2, 3.4), sy: R(12, 24), sz: R(2.2, 3.4), c: pick(PAL.weed) });
  }
  plantLists.boulder = plantLists.boulder.filter(b => {
    const cx = Math.sign(b.x) * (69 + 6 * Math.sin(b.z * 0.03 + (b.x > 0 ? 1.3 : 0.2)));
    return b.z < -150 || b.z > 165 || Math.abs(b.x-cx) > 9 + Math.max(b.sx || b.s || 0, b.sz || b.s || 0)*0.8;
  });
  for (const b of plantLists.boulder) if (b.sx > 2.4) obst(b.x, b.z, Math.max(b.sx, b.sz) * 0.78, b.y - 6, b.y + b.sy * 0.9);
  for (const k of plantLists.kelp) obst(k.x, k.z, 0.7, k.y - 2, k.y + k.sy);
}
/* ---- geometry helpers: vertex-coloured parts ---- */
function tint(g, fn){ const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color(); for (let i = 0; i < p.count; i++){ fn(p.getX(i), p.getY(i), p.getZ(i), col); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
const flatTint = (g, r, gg = r, b = r) => tint(g, (x, y, z, c) => c.setRGB(r, gg, b));
function prep(g){ g = g.index ? g.toNonIndexed() : g; if (g.attributes.uv) g.deleteAttribute('uv'); if (!g.attributes.normal) g.computeVertexNormals(); return g; }
const mergeC = list => mergeGeometries(list.map(prep), false);
/** tapered limb between two points */
const _ya = new THREE.Vector3(0, 1, 0);
function limb(a, b, r0, r1, seg = 8, open = true){
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, open); g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_ya, d.normalize())); g.translate(A.x, A.y, A.z); return g;
}
function seededRand(seed){ const f = mulberry32(seed); return (a, b) => a + (b - a) * f(); }
function weedGeo(){
  const parts = [];
  for (const rot of [0, Math.PI / 3, Math.PI * 2 / 3]){
    const g = new THREE.PlaneGeometry(0.7, 1, 2, 20); g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++){ const y = p.getY(i), x = p.getX(i);
      const w = (1 - y * 0.55) * (0.75 + 0.3 * Math.sin(y * 10.0 + rot)) * (y < 0.06 ? 0.4 + y * 10 : 1);
      p.setX(i, x * w + Math.sin(y * 3.4 + rot) * 0.18); p.setZ(i, Math.sin(y * 2.6 + rot * 2.0) * 0.14 + Math.abs(x) * 0.25 * Math.sin(y * 6.0)); }
    g.rotateY(rot); parts.push(g);
  }
  const g = mergeNI(parts); g.computeVertexNormals();
  return tint(g, (x, y, z, c) => { const k = 0.38 + 0.72 * smooth(0, 1, y); c.setRGB(k, k, k * 1.02); });
}
function coralGeo(seed){
  const rnd = seededRand(seed), parts = [];
  const grow = (x, y, z, dx, dy, dz, len, r, depth) => {
    const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
    parts.push(limb([x, y, z], [ex, ey, ez], r, r * 0.78, LOW ? 5 : 7));
    const s = new THREE.SphereGeometry(r * 0.8, LOW ? 5 : 7, LOW ? 3 : 5); s.translate(ex, ey, ez); parts.push(s);
    if (depth > 0){ const n = rnd(0, 1) < 0.35 ? 3 : 2;
      for (let k = 0; k < n; k++){ const a = rnd(0, TAU); const spread = rnd(0.45, 0.85);
        let ndx = dx + Math.sin(a) * spread, ndz = dz + Math.cos(a) * spread, ndy = dy + rnd(0.15, 0.45); const l = Math.hypot(ndx, ndy, ndz);
        grow(ex, ey, ez, ndx / l, ndy / l, ndz / l, len * rnd(0.68, 0.85), r * 0.74, depth - 1); } }
    else { const t = new THREE.SphereGeometry(r * 1.05, LOW ? 6 : 8, LOW ? 4 : 6); t.translate(ex, ey, ez); parts.push(t); }
  };
  for (let k = 0; k < 3; k++){ const a = k * TAU / 3 + rnd(0, 1); const dx = Math.sin(a) * 0.35, dz = Math.cos(a) * 0.35; const l = Math.hypot(dx, 1, dz); grow(0, 0, 0, dx / l, 1 / l, dz / l, LOW ? 0.4 : 0.32, LOW ? 0.085 : 0.075, LOW ? 2 : 3); }
  const g = mergeC(parts);
  return tint(g, (x, y, z, c) => { const k = 0.6 + 0.6 * smooth(0, 0.95, y); c.setRGB(Math.min(k * 1.05, 1.25), k, k * 0.95); });
}
function tubeGeo(){
  const rnd = seededRand(77), parts = [];
  for (let k = 0; k < 7; k++){
    const a = k * TAU / 7 + rnd(0, 0.6), d = k === 0 ? 0 : rnd(0.18, 0.34), h = rnd(0.55, 1.15), r = rnd(0.07, 0.11);
    const x = Math.sin(a) * d, z = Math.cos(a) * d, tilt = d * 0.6;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt)).setPosition(x, 0, z);
    const outer = tint(new THREE.CylinderGeometry(r * 1.1, r * 0.95, h, 14, 4, true).translate(0, h / 2, 0), (px, py, pz, c) => { const t = 0.75 + 0.35 * py / h; c.setRGB(t, t * 0.95, t * 0.9); });
    const inner = new THREE.CylinderGeometry(r * 0.82, r * 0.7, h * 0.96, 14, 1, true).translate(0, h * 0.52, 0); inner.scale(-1, 1, 1); flatTint(inner, 0.18, 0.1, 0.08);
    const lip = flatTint(new THREE.TorusGeometry(r * 0.98, r * 0.16, 6, 16).rotateX(Math.PI / 2).translate(0, h, 0), 1.15, 1.05, 0.95);
    for (const g of [outer, inner, lip]){ g.applyMatrix4(m); parts.push(g); }
  }
  return mergeC(parts);
}
function brainGeo(){
  const rnd = seededRand(31), parts = [];
  for (let k = 0; k < 8; k++){
    const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, ox = rnd(0, 9), oz = rnd(0, 9);
    for (let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const kk = 1 + 0.16 * vnoise(x * 3 + ox, z * 3 + y * 3 + oz) + 0.06 * Math.sin(x * 14 + Math.sin(z * 11) * 2) * Math.cos(z * 13 + y * 9);
      p.setXYZ(i, x * kk, Math.max(y, -0.3) * kk, z * kk); }
    const a = k * TAU / 7, d = k === 0 ? 0 : rnd(0.35, 0.6), s = k === 0 ? 0.55 : rnd(0.28, 0.42);
    g.scale(s, s * 0.85, s); g.translate(Math.sin(a) * d, k === 0 ? 0.3 : s * 0.5, Math.cos(a) * d); g.computeVertexNormals(); parts.push(g);
  }
  const g = mergeC(parts);
  return tint(g, (x, y, z, c) => { const k = 0.7 + 0.45 * smooth(-0.1, 0.8, y); c.setRGB(k, k, k * 0.92); });
}
function fanGeo(){
  const rnd = seededRand(5), parts = [];
  const br = (x, y, a, len, r, depth) => {
    const ex = x + Math.sin(a) * len, ey = y + Math.cos(a) * len;
    parts.push(limb([x, y, 0], [ex, ey, Math.sin(ey * 3) * 0.05], r, r * 0.8, 4));
    if (depth > 0) for (const s of [-1, 1]) br(ex, ey, a + s * rnd(0.25, 0.55), len * rnd(0.72, 0.86), r * 0.8, depth - 1);
  };
  br(0, 0, 0, 0.32, 0.045, 5); br(0, 0, -0.6, 0.28, 0.04, 4); br(0, 0, 0.6, 0.28, 0.04, 4);
  const g = mergeC(parts);
  return tint(g, (x, y, z, c) => { const k = 0.65 + 0.5 * smooth(0, 1.2, y); c.setRGB(k, k, k); });
}
function anemGeo(){
  const parts = [tint(new THREE.CylinderGeometry(0.3, 0.36, 0.34, 16).translate(0, 0.17, 0), (x, y, z, c) => c.setRGB(0.55, 0.45, 0.5))];
  const disc = flatTint(new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2).translate(0, 0.341, 0), 0.9, 0.75, 0.6); parts.push(disc);
  const N = 44;
  for (let i = 0; i < N; i++){
    const a = i * 2.39996, rr = 0.06 + 0.22 * Math.sqrt((i + 0.5) / N), L = 0.45 + 0.35 * ((i * 7) % 5) / 5;
    const out = 0.25 + rr * 2.2, pts = [];
    for (let k = 0; k <= 4; k++){ const t = k / 4; pts.push(new THREE.Vector3(Math.sin(a) * (rr + t * L * out * 0.6), 0.34 + t * L * (1 - out * 0.35 * t), Math.cos(a) * (rr + t * L * out * 0.6))); }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, 0.028, 4, false);
    const p = tube.attributes.position;
    for (let j = 0; j < p.count; j++){ const t = clamp((p.getY(j) - 0.34) / L, 0, 1); const cx = Math.sin(a) * (rr + t * L * out * 0.6), cz = Math.cos(a) * (rr + t * L * out * 0.6); const s = 1 - t * 0.6; p.setX(j, cx + (p.getX(j) - cx) * s); p.setZ(j, cz + (p.getZ(j) - cz) * s); }
    tube.computeVertexNormals();
    parts.push(tint(tube, (x, y, z, c) => { const t = clamp((y - 0.34) / L, 0, 1); const k = 0.7 + 0.5 * t; c.setRGB(k, k * (0.9 + 0.2 * t), k); }));
  }
  return mergeC(parts);
}
function tableGeo(){
  const parts = [tint(limb([0, 0, 0], [0, 0.45, 0], 0.09, 0.06, 8, false), (x, y, z, c) => c.setRGB(0.6, 0.55, 0.5))];
  for (const [y, r, ox] of [[0.45, 0.75, 0], [0.7, 0.5, 0.15], [0.88, 0.32, -0.1]]){
    const g = new THREE.CircleGeometry(r, 28, 0, TAU); g.rotateX(-Math.PI / 2); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++){ const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z) / r; p.setY(i, 0.06 * Math.sin(Math.atan2(x, z) * 7) * d * d - 0.04 * d); }
    g.translate(ox, y, 0); g.computeVertexNormals();
    const under = g.clone(); under.scale(1, 1, 1); under.translate(0, -0.03, 0); const ui = under.index; if (ui){ const a = ui.array; for (let i = 0; i < a.length; i += 3){ const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } } under.computeVertexNormals();
    parts.push(tint(g, (x, yy, z, c) => { const d = Math.hypot(x - ox, z) / r; const k = 0.75 + 0.45 * d; c.setRGB(k, k, k); }), flatTint(under, 0.5));
  }
  return mergeC(parts);
}
function boulderGeo(){ const g = new THREE.IcosahedronGeometry(1, 3); const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + 0.22 * vnoise(x * 2 + 5, z * 2 + y * 3) + 0.1 * vnoise(x * 5, y * 5 + z) + 0.04 * vnoise(x * 11, z * 11 + y); p.setXYZ(i, x * k, y * k, z * k); } g.computeVertexNormals(); return g; }
function inst(geo, mat, list, shadow = true){
  if (LOW) shadow = false;   // the shadow pass would re-draw every coral
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach((it, i) => { const s = it.s ?? 1; m.setMatrixAt(i, TM(it.x, it.y, it.z, it.r ?? 0, it.sx ?? s, it.sy ?? s, it.sz ?? s, it.rx ?? 0, it.rz ?? 0)); if (it.c) m.setColorAt(i, it.c); });
  m.name = 'plants'; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m;
}
const matGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });
function buildReef(){
  scatterReef();
  const VC = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, ...o });
  inst(weedGeo(), patch(VC({ side: THREE.DoubleSide, roughness: 0.7 }), { sway: 1 }), plantLists.weed, false);
  inst(weedGeo(), patch(VC({ side: THREE.DoubleSide, roughness: 0.75 }), { sway: 0.55 }), plantLists.kelp, true);
  const coralMat = patch(VC({ roughness: 0.55 }));
  inst(coralGeo(11), coralMat, plantLists.coral1, true); inst(coralGeo(23), coralMat, plantLists.coral2, true); inst(coralGeo(47), coralMat, plantLists.coral3, true);
  inst(tubeGeo(), patch(VC({ roughness: 0.6, side: THREE.DoubleSide })), plantLists.tube, true);
  inst(brainGeo(), patch(VC({ roughness: 0.7 })), plantLists.brain, true);
  inst(fanGeo(), patch(VC({ roughness: 0.6 }), { sway: 0.3 }), plantLists.fan, false);
  inst(anemGeo(), patch(VC({ roughness: 0.45 }), { sway: 0.9 }), plantLists.anem, false);
  inst(tableGeo(), patch(VC({ roughness: 0.6, side: THREE.DoubleSide })), plantLists.table, true);
  const stems = plantLists.glow.map(g => ({ ...g, c: new THREE.Color(0x2f6a5a), sx: g.s, sy: g.s * 1.3, sz: g.s }));
  inst(cylGeo(0.03, 0.06, 1, 6), patch(new THREE.MeshStandardMaterial({ roughness: 0.7 }), { sway: 0.6 }), stems, false);
  const bulbs = plantLists.glow.map(g => ({ ...g, y: g.y + g.s * 1.3 }));
  inst(new THREE.SphereGeometry(0.17, 12, 8), matGlow, bulbs, false);
  inst(boulderGeo(), patch(new THREE.MeshStandardMaterial({ roughness: 0.95 }), { boost: 2.2 }), plantLists.boulder, true);
  inst(bushGeo(), patch(VC({ roughness: 0.6 }), { sway: 0.25 }), plantLists.bush, true);
}


/* ---------- blue rivers filling the two channels end to end ---------- */
const riverMat = patch(new THREE.MeshStandardMaterial({ color: 0x3fb6e8, roughness: 0.12, metalness: 0.08, transparent: true, opacity: 0.9, depthWrite: false, emissive: 0x0b3c5c, emissiveIntensity: 0.35, envMapIntensity: 0.5 }), { caustic: true, water: true });
/* aurora palette that flows downstream: green → teal → violet → pink, with drifting curtains */
const AURORA_GLSL = `
vec3 auroraCol(vec2 p, float t){
  float f = p.y * 0.011 + sin(p.x * 0.11 + p.y * 0.03 + t * 0.45) * 0.28 + sin(p.y * 0.05 - t * 0.6) * 0.3 - t * 0.1;
  float u = fract(f * 0.5) * 4.0;
  vec3 g = vec3(0.22, 1.0, 0.62), b = vec3(0.26, 0.78, 1.0), v = vec3(0.66, 0.45, 1.0), pk = vec3(1.0, 0.48, 0.86);
  vec3 c = u < 1.0 ? mix(g, b, u) : u < 2.0 ? mix(b, v, u - 1.0) : u < 3.0 ? mix(v, pk, u - 2.0) : mix(pk, g, u - 3.0);
  float curtain = 0.62 + 0.38 * sin(p.x * 0.85 + t * 1.6 + sin(p.y * 0.27 + t * 0.4) * 2.2);
  return c * curtain;
}`;
let riverMode = 0;   // 0 natural · 1 落霞粉 · 2 极光
const riverU = { uPink: { value: 0 }, uAur: { value: 0 }, uPinkCol: { value: new THREE.Color('#ff7fbf') } };
{ const prev = riverMat.onBeforeCompile;
  riverMat.onBeforeCompile = sh => { prev(sh); Object.assign(sh.uniforms, riverU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBank; varying float vBank;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBank = aBank;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vBank; uniform float uPink, uAur; uniform vec3 uPinkCol;\n' + AURORA_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.a *= vBank;
        vec3 rAur = auroraCol(vCW.xz, uTime);
        diffuseColor.rgb = mix(diffuseColor.rgb, uPinkCol, uPink);
        diffuseColor.rgb = mix(diffuseColor.rgb, rAur * 0.55, uAur);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uPinkCol * 0.3 * uPink + rAur * rAur * 0.55 * uAur;`); };
  riverMat.customProgramCacheKey = () => 'river-colours'; }
/** a pool of aurora water (the swing clearing) — same palette, faded at the rim */
function auroraPoolMat(cx, cz, r){
  const m = patch(new THREE.MeshStandardMaterial({ color: 0x7fd8ff, roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.92, depthWrite: false, envMapIntensity: 0.6 }), { caustic: false, water: true });
  const prev = m.onBeforeCompile, u = { uPoolC: { value: new THREE.Vector2(cx, cz) }, uPoolR: { value: r } };
  m.onBeforeCompile = sh => { prev(sh); Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 uPoolC; uniform float uPoolR;\n' + AURORA_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 pAur = auroraCol(vCW.xz * 3.2, uTime * 1.2);
        diffuseColor.rgb = pAur * 0.55;
        diffuseColor.a *= smoothstep(uPoolR, uPoolR - 1.4, length(vCW.xz - uPoolC));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += pAur * pAur * 0.6;`); };
  m.customProgramCacheKey = () => 'aurora-pool';
  return m;
}
function buildRivers(){
  for (const sd of [-1, 1]){
    const ph = sd > 0 ? 1.3 : 0.2, rows = [];
    for (let z = -160; z <= 170; z += 1.5){
      const cx = sd * (69 + 6 * Math.sin(z * 0.03 + ph)), y = chanFloor(z) + 3.4;
      const contained = Math.min(terrainH(cx - 18 * sd, z), terrainH(cx + 18 * sd, z)) > y + 0.6;
      rows.push({ z, cx, y, ok: contained });
    }
    let a = rows.findIndex(r => r.ok), b = rows.length - 1 - [...rows].reverse().findIndex(r => r.ok);
    if (a < 0) continue;
    const seg = rows.slice(a, b + 1), pos = [], idx = [], al = [];
    seg.forEach((r, i) => {
      let wl = 0.5, wr = 0.5;
      while (wl < 18 && terrainH(r.cx - wl, r.z) < r.y) wl += 0.5;
      while (wr < 18 && terrainH(r.cx + wr, r.z) < r.y) wr += 0.5;
      const endF = Math.min(1, i / 6, (seg.length - 1 - i) / 6);
      [-1, -0.75, 0, 0.75, 1].forEach((u, j) => { pos.push(r.cx + u * ((u < 0 ? wl : wr) + 1.2), r.y, r.z); al.push([0.85, 1, 1, 1, 0.85][j] * endF); });
      if (i > 0) for (let j = 0; j < 4; j++){ const k = (i - 1) * 5 + j; idx.push(k, k + 5, k + 1, k + 1, k + 5, k + 6); }
    });
    const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aBank', new THREE.Float32BufferAttribute(al, 1)); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0){ const ar = g.index.array; for (let i = 0; i < ar.length; i += 3){ const t = ar[i]; ar[i] = ar[i + 1]; ar[i + 1] = t; } g.computeVertexNormals(); }
    const m = new THREE.Mesh(g, riverMat); m.name = 'river'; m.renderOrder = 2; m.receiveShadow = true; scene.add(m);
    interactives.push({ obj: m, kind: 'river', label: '点击 · 让河水换个颜色' });
  }
}

/* =====================================================================
   9. Distant skyline on reef mesas (atmospheric perspective)
   ===================================================================== */
function buildFarCity(){
  const pieces = { far: [], farDome: [], mesa: [] };
  const P = (n, g, m) => { const gg = (g.index ? g.toNonIndexed() : g.clone()); gg.applyMatrix4(m); gg.deleteAttribute('uv'); pieces[n].push(gg); };
  for (let i = 0; i < 34; i++){
    const back = rand() < 0.62;
    const a = back ? R(Math.PI * 0.62, Math.PI * 1.38) : R(0, TAU);
    const dist = R(340, 640), x = Math.sin(a) * dist * 1.1, z = Math.cos(a) * dist;
    const mr = R(22, 46), base = outerH(x, z) - 6, mt = base + R(22, 46), H = mt - base;
    // rounded reef outcrop: a lumpy dome with soft ledges, buried below the seabed
    const rg = new THREE.IcosahedronGeometry(1, 4);
    const rp = rg.attributes.position;
    for (let j = 0; j < rp.count; j++){ let px = rp.getX(j), py = rp.getY(j), pz = rp.getZ(j);
      const k = 1 + 0.2 * vnoise(px * 1.6 + i * 3.1, pz * 1.6 + py * 2.0 + i) + 0.09 * vnoise(px * 4.2 + i, py * 4.2 - pz * 2.0) + 0.035 * vnoise(px * 9 - i, pz * 9 + py * 5);
      px *= k; pz *= k; py *= k;
      const t = clamp(py, 0, 1.3); const ledge = (vnoise(t * 5.0 + i, i * 0.7) - 0.5) * 0.12;
      const flare = 1 + 0.45 * smooth(0.55, -0.1, py);
      rp.setXYZ(j, px * mr * (flare + ledge), py * H * (0.92 + 0.16 * vnoise(px * 2 + i, pz * 2)), pz * mr * 0.92 * (flare + ledge)); }
    rg.computeVertexNormals();
    P('mesa', rg, TM(x, base, z, rand() * TAU));
  }
  const g3 = new THREE.Mesh(mergeGeometries(pieces.mesa), patch(new THREE.MeshStandardMaterial({ color: 0x2e4854, roughness: 0.95 }), { boost: 1.2 }));
  g3.name = 'far'; scene.add(g3);
}

/* =====================================================================
   6b. The sanctum library (ref 11): carved doors, round book hall, pearl shell, mermaid (ref 12)
   ===================================================================== */
const interactives = [];
const deferred = [];          // { obj, kind, label }
const props = {};                  // animated props: door, mermaid, booth, swing ...
/** tube along a curve with a radius profile; adds aT (0..1 along the curve) */
function varTube(points, rFn, segs = 64, rad = 14, colorFn = null){
  const curve = new THREE.CatmullRomCurve3(points), fr = curve.computeFrenetFrames(segs, false);
  const pos = [], nrm = [], col = [], aT = [], idx = [], c = new THREE.Color(), P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++){
    const t = i / segs; curve.getPointAt(t, P); const r = rFn(t);
    for (let j = 0; j <= rad; j++){ const a = j / rad * TAU, ca = Math.cos(a), sa = Math.sin(a);
      N.copy(fr.normals[i]).multiplyScalar(ca).addScaledVector(fr.binormals[i], sa).normalize();
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r); nrm.push(N.x, N.y, N.z); aT.push(t);
      if (colorFn) colorFn(t, a, c); else c.setRGB(1, 1, 1); col.push(c.r, c.g, c.b); }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++){ const a = i * (rad + 1) + j, b = a + rad + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  return { geo: g, curve, frames: fr };
}
function scallopGeo(Rr, half, cup, ribs, rows = 26){
  const cols = ribs * 8, pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i <= rows; i++){ const r = Rr * (0.05 + 0.95 * i / rows), q = r / Rr;
    for (let j = 0; j <= cols; j++){ const th = -half + 2 * half * j / cols, rib = Math.cos(th * ribs * Math.PI / half);
      const rr = r * (1 + 0.035 * q * q * rib);
      pos.push(rr * Math.sin(th), rr * Math.cos(th), cup * Math.pow(q, 1.6) + 0.075 * Rr * q * rib);
      c.setHSL(0.58 + 0.22 * th / half + 0.12 * q, 0.55, 0.86 + 0.06 * rib); col.push(c.r, c.g, c.b); } }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++){ const a = i * (cols + 1) + j, b = a + cols + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
function mosaicTexture(){
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d'), c = S / 2;
  g.fillStyle = '#efe8da'; g.fillRect(0, 0, S, S);
  const pal = ['#f4f8f8', '#a8dce4', '#5fb0c8', '#2f6f95', '#f2e2c4', '#cfe9ee'];
  for (let r = 28; r < c - 6; r += 15){
    const n = Math.floor(TAU * r / 13), ring = Math.floor(r / 15);
    for (let k = 0; k < n; k++){ const a = k / n * TAU + ring * 0.13; g.fillStyle = ring % 7 === 3 || ring % 7 === 4 ? pal[2 + (k % 2)] : pal[(k * 7 + ring * 3) % pal.length];
      g.beginPath(); g.ellipse(c + Math.cos(a) * r, c + Math.sin(a) * r, 5.5 + (k % 3), 4.5, a, 0, TAU); g.fill(); }
  }
  g.strokeStyle = 'rgba(200,170,100,0.9)'; g.lineWidth = 4; for (const r of [120, 330, 505]){ g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
  for (let k = 0; k < 16; k++){ const a = k / 16 * TAU; g.fillStyle = k % 2 ? '#5fb0c8' : '#f2e2c4'; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a - 0.12) * 110, c + Math.sin(a - 0.12) * 110); g.lineTo(c + Math.cos(a) * 118, c + Math.sin(a) * 118); g.lineTo(c + Math.cos(a + 0.12) * 110, c + Math.sin(a + 0.12) * 110); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function twistColGeo(h, r){
  const g = new THREE.CylinderGeometry(r, r, h, 20, 48, false); g.translate(0, h / 2, 0); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++){ const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(x, z), d = Math.hypot(x, z); if (d < 1e-4) continue;
    const k = 1 + 0.13 * Math.sin(a * 4 + y * 2.4); p.setX(i, x * k); p.setZ(i, z * k); }
  g.computeVertexNormals(); return g;
}
const libU = { uTime: U.uTime, uCol: { value: new THREE.Color(0x6fe0ee) }, uI: { value: 1 } };
function buildLibrary(T, mz){
  const F = T + 0.65, cz = mz;
  // floor + mosaic
  boxB('marble', 0, T, cz, 30, 0.64, 26);
  const mos = new THREE.Mesh(new THREE.CircleGeometry(11.3, 96).rotateX(-Math.PI / 2), patch(new THREE.MeshStandardMaterial({ map: mosaicTexture(), roughness: 0.45 })));
  mos.position.set(0, F + 0.012, cz); mos.receiveShadow = true; scene.add(mos);
  // dais
  band('marble', 0, cz, 0, 6.0, F, F + 0.3); band('trim', 0, cz, 5.75, 6.1, F + 0.22, F + 0.32);
  band('marble', 0, cz, 0, 5.0, F + 0.3, F + 0.6); band('trim', 0, cz, 4.75, 5.1, F + 0.52, F + 0.62);
  band('marble', 0, cz, 0, 3.9, F + 0.6, F + 0.9); band('gold', 0, cz, 3.8, 3.95, F + 0.84, F + 0.92);
  // shelving ring with twisted columns, gallery and arched bays
  const GAP = 0.27, A0 = GAP, A1 = TAU - GAP, NB = 14, da = (A1 - A0) / NB;
  band('shade', 0, cz, 12.7, 13.05, F, F + 16.3, A0 - 0.03, A1 + 0.03);
  for (const y of [0, 1.25, 2.5, 3.75, 5.0, 6.25, 7.4, 8.6, 9.8, 11.0, 12.2, 13.4]) band('trim', 0, cz, 11.6, 12.75, F + y, F + y + 0.13, A0, A1);
  band('marble', 0, cz, 9.9, 12.75, F + 6.65, F + 7.05, A0, A1); band('trim', 0, cz, 9.7, 9.95, F + 6.5, F + 7.1, A0, A1);
  ringRail(0, cz, 10.15, F + 7.05, A0 + 0.02, A1 - 0.02);
  band('trim', 0, cz, 11.0, 13.05, F + 14.4, F + 15.1, A0, A1); band('gold', 0, cz, 10.95, 11.05, F + 14.55, F + 14.75, A0, A1);
  const colG = twistColGeo(14.4, 0.4);
  for (let k = 0; k <= NB; k++){
    const a = A0 + k * da, x = 11.35 * Math.sin(a), z = cz + 11.35 * Math.cos(a);
    put('marble', colG, TM(x, F, z)); boxB('trim', x, F, z, 1.1, 0.4, 1.1, a); boxB('trim', x, F + 14.0, z, 1.15, 0.45, 1.15, a); put('gold', sphGeo(0.12, 8, 6), TM(x, F + 14.6, z));
    boxB('trim', 12.2 * Math.sin(a), F, cz + 12.2 * Math.cos(a), 0.22, 14.4, 1.1, a);
    obst(x, z, 0.6, F - 1, F + 15);
  }
  const archG = new THREE.TorusGeometry(1, 0.11, 6, 24, Math.PI);
  for (let k = 0; k < NB; k++){ const a = A0 + (k + 0.5) * da, ch = 11.62 * 2 * Math.sin(da / 2) / 2 - 0.35;
    for (const [y, sy] of [[F + 5.0, 0.42], [F + 12.1, 0.46]]) put('gold', archG, TM(11.62 * Math.sin(a), y, cz + 11.62 * Math.cos(a), a, ch, ch * sy * 2.2, 1)); }
  // books
  const books = [], bc = [0x7a1f2b, 0x1f3a6e, 0x2c6a5a, 0x6b4a2a, 0xb08a3a, 0xe8dcc0, 0x3a2a5a, 0x8a3a1a, 0x2a5a8a, 0x5a6a2a, 0x9a2a4a, 0x1a4a4a].map(h => new THREE.Color(h));
  for (const y0 of [0.13, 1.38, 2.63, 3.88, 5.13, 7.53, 8.73, 9.93, 11.13, 12.33]){
    for (let k = 0; k < NB; k++){ let a = A0 + k * da + 0.055; const aEnd = A0 + (k + 1) * da - 0.055;
      while (a < aEnd){ const w = R(0.1, 0.2), h = R(0.72, 1.02), dA = w / 12.15; if (a + dA > aEnd) break;
        if (rand() < 0.04){ a += dA * 2; continue; }
        const lean = rand() < 0.06 ? R(-0.25, 0.25) : 0;
        books.push({ m: TM(12.15 * Math.sin(a + dA / 2), F + y0 + h / 2, cz + 12.15 * Math.cos(a + dA / 2), a + dA / 2, w, h, R(0.5, 0.7), 0, lean), c: pick(bc).clone().multiplyScalar(R(0.75, 1.15)) });
        a += dA + 0.004; } }
  }
  const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), patch(new THREE.MeshStandardMaterial({ roughness: 0.7 }), { caustic: false }), books.length);
  books.forEach((b, i) => { bm.setMatrixAt(i, b.m); bm.setColorAt(i, b.c); }); bm.receiveShadow = true; bm.frustumCulled = false; scene.add(bm);
  // glass dome ceiling showing the sea above
  const ocMat = new THREE.ShaderMaterial({ uniforms: libU, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uI; uniform vec3 uCol; varying vec3 vP;
      void main(){ float r = length(vP.xz) / 8.0, a = atan(vP.x, vP.z);
        vec2 p = vP.xz * 0.55; float w = sin(p.x * 1.7 + uTime * 0.8) * sin(p.y * 1.9 - uTime * 0.6) + sin((p.x + p.y) * 2.3 + uTime) * 0.6;
        vec3 c = mix(vec3(0.85, 1.0, 1.0), uCol, smoothstep(0.0, 0.9, r)) * (1.05 - 0.35 * r);
        c += vec3(0.9, 1.0, 1.0) * smoothstep(0.9, 1.5, w) * 0.4 * (1.0 - r * 0.6);
        float seg = abs(fract(a / 6.28318 * 16.0) - 0.5) * 2.0;
        float ribs = (1.0 - smoothstep(0.0, 0.06 / max(r, 0.15), 1.0 - seg)) * step(0.12, r);
        float rings = 1.0 - smoothstep(0.0, 0.02, abs(fract(r * 3.0 + 0.5) - 0.5));
        c = mix(c, vec3(0.98, 0.85, 0.52), clamp(ribs + rings * step(0.2, r), 0.0, 1.0) * 0.9);
        gl_FragColor = vec4(c * uI, 1.0); }` });
  const oc = new THREE.Mesh(new THREE.SphereGeometry(8, 64, 20, 0, TAU, 0, Math.PI / 2), ocMat); oc.scale.set(1, 0.55, 1); oc.position.set(0, T + 17, cz); scene.add(oc);
  const ceil = new THREE.Shape([new THREE.Vector2(-15, -13), new THREE.Vector2(15, -13), new THREE.Vector2(15, 13), new THREE.Vector2(-15, 13)]);
  const hole = new THREE.Path(); hole.absarc(0, 0, 8, 0, TAU, true); ceil.holes.push(hole);
  const cg = new THREE.ExtrudeGeometry(ceil, { depth: 1, bevelEnabled: false, curveSegments: 48 }); cg.rotateX(-Math.PI / 2);
  put('marble', cg, TM(0, T + 17, cz));
  put('gold', new THREE.TorusGeometry(8.05, 0.22, 8, 96).rotateX(Math.PI / 2), TM(0, T + 17, cz));
  band('trim', 0, cz, 8.0, 9.2, T + 16.5, T + 17.0);
  // a soft shaft of light from the dome onto the shell
  deferred.push(() => {
  const shaft = new THREE.Mesh(rayGeo, new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(0xd8fbff) }, uI: { value: 0.16 }, uRainbow: { value: 0 }, uTime: U.uTime, uSeed: { value: 0.3 }, uRb: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, vertexShader: rays[0].material.vertexShader, fragmentShader: rays[0].material.fragmentShader }));
  shaft.position.set(0, T + 17.5, cz - 1); shaft.scale.set(2.2, 16.5, 2.2); shaft.renderOrder = 5; scene.add(shaft);
  });
  for (const [x, y, z, c, i] of [[0, F + 9, cz + 4, 0xffe2b0, 55], [0, F + 13, cz - 2, 0x9fe8ff, 45], [-6, F + 3, cz - 4, 0xffb8e0, 18]]){ const l = new THREE.PointLight(c, i, 26, 1.6); l.position.set(x, y, z); scene.add(l); }
  // pedestals with open books, floating pages
  const pageMat = new THREE.MeshStandardMaterial({ color: 0xf6efdc, roughness: 0.8, side: THREE.DoubleSide, emissive: 0x332a18, emissiveIntensity: 0.25 });
  const pageG = (() => { const g = new THREE.PlaneGeometry(0.62, 0.84, 6, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++){ const x = p.getX(i) + 0.31; p.setZ(i, Math.sin(x / 0.62 * Math.PI) * 0.06); } g.computeVertexNormals(); return g; })();
  props.pages = [];
  for (const sx of [-1, 1]){
    const px = sx * 6.6, pz = cz + 3.2;
    cyl('marble', px, F, pz, 0.55, 0.25, 20); cyl('marble', px, F + 0.25, pz, 0.28, 1.0, 16, 0.22); boxB('trim', px, F + 1.25, pz, 1.5, 0.12, 1.05, 0);
    if (sx < 0){   // 《潮汐之书》: a slanted lectern carries a real page-flip book — nothing rests inside the stone any more
      const stand = new THREE.Group(); stand.position.set(px, F + 1.37, pz); stand.rotation.y = 0.62; scene.add(stand);
      const wood = patch(new THREE.MeshStandardMaterial({ color: 0x6a4630, roughness: 0.55, metalness: 0.05 }));
      const TILT = 0.3, BW = 1.78, BD = 1.22, BT = 0.06;
      { const sh = new THREE.Shape(); sh.moveTo(-BD / 2, 0); sh.lineTo(BD / 2, 0); sh.lineTo(-BD / 2, BD * Math.tan(TILT)); sh.closePath();   // wedge under the board
        const wg = new THREE.ExtrudeGeometry(sh, { depth: BW * 0.86, bevelEnabled: false }); wg.translate(0, 0, -BW * 0.43); wg.rotateY(-Math.PI / 2);   // profile x → z: tall at the back, flush at the front
        const wedge = new THREE.Mesh(wg, wood); wedge.castShadow = wedge.receiveShadow = true; stand.add(wedge); }
      const board = new THREE.Group(); board.position.set(0, BD / 2 * Math.tan(TILT) + 0.005, 0); board.rotation.x = TILT; stand.add(board);
      const top = new THREE.Mesh(new THREE.BoxGeometry(BW, BT, BD), wood); top.position.y = BT / 2; top.castShadow = top.receiveShadow = true; board.add(top);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(BW, 0.08, 0.05), mats.gold); lip.position.set(0, BT + 0.03, BD / 2 - 0.02); board.add(lip);
      const book = createBook({ pages: BOOK_PAGES(), low: LOW }); book.group.position.set(0, BT + 0.024, -0.02); board.add(book.group);
      const sp = []; for (let k = 0; k < 40; k++) sp.push(R(-0.8, 0.8), R(0.15, 1.6), R(-0.5, 0.5));
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      const spark = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xbff4ff, size: 0.06, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false })); spark.frustumCulled = false; board.add(spark);
      const hit = hitBox(board, BW, 0.9, BD, 0.4);
      props.book = { book, stand, board, spark, active: 0, a: 0 };
      interactives.push({ obj: hit, anchor: stand, kind: 'book', label: '点击 · 翻开潮汐之书' });
      obst(px, pz, 1.05, F - 1, F + 2.4);
    } else {
      const bookG = new THREE.Group(); bookG.position.set(px, F + 1.4, pz); bookG.rotation.set(-0.2, sx * -0.4, 0);
      const cover = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.05, 0.92), new THREE.MeshStandardMaterial({ color: 0x6a2030, roughness: 0.6 })); cover.position.y = 0.05; bookG.add(cover);
      for (const s of [-1, 1]){ const pg = new THREE.Mesh(pageG, pageMat); pg.rotation.set(-Math.PI / 2, 0, s < 0 ? Math.PI : 0); pg.position.set(0, 0.1, 0); pg.scale.set(s, 1, 1); bookG.add(pg); }
      scene.add(bookG); obst(px, pz, 0.85, F - 1, F + 2);
    }
    // loose pages drift in a ring above head height, clear of the lectern
    for (let k = 0; k < 4; k++){ const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.56), pageMat); const a = rand() * TAU, rr = R(1.7, 2.4), base = new THREE.Vector3(px + Math.sin(a) * rr, F + R(3.0, 4.8), pz + Math.cos(a) * rr * 0.8 - (sx < 0 ? 0.6 : 0)); m.position.copy(base); scene.add(m); props.pages.push({ m, base, ph: rand() * TAU }); }
  }
  // coral planters + crystals
  const cry = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x3fb8ff, emissiveIntensity: 1.1, roughness: 0.15, metalness: 0.1 });
  for (const a of [0.75, -0.75, 2.2, -2.2]){
    const x = 9.3 * Math.sin(a), z = cz + 9.3 * Math.cos(a);
    band('trim', x, z, 1.15, 1.4, F, F + 0.95); band('soil', x, z, 0, 1.15, F, F + 0.85); plantCluster(x, F + 0.85, z, 1.0, 10); obst(x, z, 1.5, F - 1, F + 3);
    for (let k = 0; k < 3; k++){ const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.22 + k * 0.06, 0), cry); c.scale.set(0.6, 1.8, 0.6); c.position.set(x + R(-0.6, 0.6), F + 1.3 + k * 0.1, z + R(-0.6, 0.6)); c.rotation.set(R(-0.3, 0.3), R(0, 3), R(-0.3, 0.3)); scene.add(c); }
  }
  // giant iridescent scallop (Blender) on a pearl pedestal
  const shellMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.16, metalness: 0.12, iridescence: 1.0, iridescenceIOR: 1.6, iridescenceThicknessRange: [220, 820],
    clearcoat: 1.0, clearcoatRoughness: 0.08, sheen: 0.7, sheenColor: new THREE.Color(0xffd2ee), emissive: 0x3c2c60, emissiveIntensity: 0.32, side: THREE.DoubleSide });
  shellMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPearl;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPearl=position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPearl;').replace('#include <color_fragment>', `#include <color_fragment>
      vec3 pearlTint=0.76+0.22*cos(6.28318*(vPearl.y*1.8+vPearl.z*0.7+vec3(0.08,0.36,0.7)));
      diffuseColor.rgb*=pearlTint;`);
  };
  shellMat.customProgramCacheKey=()=> 'pearl-refined';
  const hingeY = F + 2.62, hingeZ = cz - 2.6;
  band('marble', 0, cz - 0.6, 0, 1.9, F + 0.9, F + 2.0); band('gold', 0, cz - 0.6, 1.85, 1.98, F + 1.85, F + 2.0); band('trim', 0, cz - 0.6, 1.9, 2.15, F + 0.9, F + 1.1);
  const backMesh = gShell.scene.getObjectByName('ShellBack'), bowlMesh = gShell.scene.getObjectByName('ShellBowl');
  // Preserve meshopt's local decode transforms: transform wrappers, not decoded meshes.
  const back = new THREE.Group(), bowl = new THREE.Group();
  for (const [g, m] of [[back, backMesh], [bowl, bowlMesh]]){ m.traverse(o => { if (o.isMesh){ o.material = shellMat; o.castShadow = true; o.receiveShadow = true; } }); g.add(m); scene.add(g); }
  back.rotation.order = 'YXZ'; back.rotation.set(Math.PI / 2 + 0.2, Math.PI, 0); back.position.set(0, hingeY - 0.1, hingeZ - 0.15);
  bowl.rotation.set(0, Math.PI, 0); bowl.position.set(0, hingeY, hingeZ);
  obst(0, cz - 1.0, 3.6, F - 1, F + 8);
  // mermaid princess (ref 9) as a tech hologram rising from a projector in front of the shell
  const holo = buildHolo(); holo.position.set(0, F + 0.9, cz + 2.4); scene.add(holo); obst(0, cz + 2.4, 1.6, F - 1, F + 6);
  // book stacks and open books on the dais steps (ref 4)
  { const bcol = [0x6a2030, 0x1f3a6e, 0x2c6a5a, 0x8a6a3a, 0x3a2a5a, 0xe8dcc0, 0x9a2a4a];
    const stack = (x, y, z, n, ry) => { let yy = y; for (let k = 0; k < n; k++){ const w = R(0.62, 0.8), h = R(0.1, 0.16), d = R(0.45, 0.58);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: pick(bcol), roughness: 0.7 })); b.position.set(x, yy + h / 2, z); b.rotation.y = ry + R(-0.25, 0.25); b.castShadow = b.receiveShadow = true; scene.add(b); yy += h; } };
    for (const [a, r, y, n] of [[0.75, 4.45, F + 0.6, 3], [-0.8, 4.4, F + 0.6, 4], [1.25, 5.5, F + 0.3, 2], [-1.3, 5.45, F + 0.3, 3], [2.3, 4.5, F + 0.6, 2], [-2.25, 4.5, F + 0.6, 3]])
      stack(r * Math.sin(a), y, cz + r * Math.cos(a), n, a);
    for (const [a, r, y] of [[0.45, 5.4, F + 0.3], [-0.42, 5.4, F + 0.3]]){ const bk = new THREE.Group(); bk.position.set(r * Math.sin(a), y + 0.03, cz + r * Math.cos(a)); bk.rotation.y = a;
      const cv = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.75), new THREE.MeshStandardMaterial({ color: 0x5a1f2a, roughness: 0.6 })); bk.add(cv);
      for (const sd of [-1, 1]){ const pg = new THREE.Mesh(pageG, pageMat); pg.rotation.set(-Math.PI / 2, 0, sd < 0 ? Math.PI : 0); pg.position.y = 0.04; pg.scale.set(sd * 0.85, 0.85, 1); bk.add(pg); }
      scene.add(bk); } }
  // glowing violet coral flanking the doors inside (ref 4)
  for (const sx of [-1, 1]) glowCoral(sx * 3.6, F, -5.2, sx < 0 ? 0xb07cff : 0x7fb8ff, 1.5);
  props.holo = holo.userData;
  interactives.push({ obj: holo.userData.hit, kind: 'mermaid', label: '点击 · 人鱼全息虚影' });
  // carved double doors (ref 11)
  buildDoors(F, -3.5);
  // walk zones
  const ped = [{ k: 'c', x: -6.6, z: cz + 3.2, r: 1.1 }, { k: 'c', x: 6.6, z: cz + 3.2, r: 1.1 }];
  const pl = [0.75, -0.75, 2.2, -2.2].map(a => ({ k: 'c', x: 9.3 * Math.sin(a), z: cz + 9.3 * Math.cos(a), r: 1.7 }));
  zoneDisk(0, cz, 10.6, F, [{ k: 'c', x: 0, z: cz, r: 6.0 }, ...ped, ...pl]);
  zoneDisk(0, cz, 6.0, F + 0.3, [{ k: 'c', x: 0, z: cz, r: 5.0 }]); zoneDisk(0, cz, 5.0, F + 0.6, [{ k: 'c', x: 0, z: cz, r: 3.9 }]); zoneDisk(0, cz, 3.9, F + 0.9);
  zoneRect(0, -4.7, 2.3, 2.3, F);
}
function buildDoors(F, z){
  const doorMat = patch(new THREE.MeshStandardMaterial({ color: 0x2e6b7c, roughness: 0.48, metalness: 0.25 }));
  const W = 2.6, H = 8.6, D = 0.24;
  const leafShape = () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(W, 0); s.lineTo(W, H); s.absarc(W, H - W, W, Math.PI / 2, Math.PI, false); s.lineTo(0, 0); return s; };
  const panel = (x0, y0, w, h, top) => { const s = new THREE.Shape(); s.moveTo(x0, y0); s.lineTo(x0 + w, y0); if (top){ s.lineTo(x0 + w, y0 + h - w / 2); s.absarc(x0 + w / 2, y0 + h - w / 2, w / 2, 0, Math.PI, false); } else { s.lineTo(x0 + w, y0 + h); s.lineTo(x0, y0 + h); } s.lineTo(x0, y0); return s; };
  props.door = { open: 0, t: 0, leaves: [] };
  for (const sd of [-1, 1]){
    const pivot = new THREE.Group(); pivot.position.set(sd * W, F, z); scene.add(pivot);
    const leaf = new THREE.Group(); leaf.scale.x = -sd; pivot.add(leaf);
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(leafShape(), { depth: D, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 20 }), doorMat);
    body.position.z = -D / 2; leaf.add(body);
    for (const [x0, y0, w, h, top] of [[0.35, 0.5, 1.9, 2.6, false], [0.35, 3.5, 1.9, 4.0, true]]){
      for (const zz of [D / 2 + 0.03, -D / 2 - 0.09]){
        const outer = panel(x0, y0, w, h, top); outer.holes.push(new THREE.Path(panel(x0 + 0.14, y0 + 0.14, w - 0.28, h - 0.28, top).getPoints(24)));
        const fr = new THREE.Mesh(new THREE.ExtrudeGeometry(outer, { depth: 0.06, bevelEnabled: false, curveSegments: 16 }), mats.gold); fr.position.z = zz; leaf.add(fr);
      }
    }
    // gilded vine filigree on the upper panel
    for (const zz of [D / 2 + 0.07, -D / 2 - 0.07]){
      const pts = []; for (let k = 0; k <= 12; k++){ const t = k / 12; pts.push(new THREE.Vector3(1.3 + Math.sin(t * 9) * 0.45 * (1 - t * 0.4), 3.9 + t * 3.1, zz)); }
      leaf.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 5, false), mats.gold));
      for (let k = 0; k < 5; k++){ const c = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 5, 12, Math.PI * 1.5), mats.gold); c.position.set(1.3 + (k % 2 ? 0.4 : -0.4), 4.3 + k * 0.6, zz); c.rotation.z = k * 1.3; leaf.add(c); }
    }
    for (const zz of [D / 2 + 0.12, -D / 2 - 0.12]){ const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 20), mats.gold); ring.position.set(W - 0.35, 3.6, zz); leaf.add(ring);
      const boss = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), mats.gold); boss.position.set(W - 0.35, 3.78, zz); leaf.add(boss); }
    leaf.traverse(o => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
    props.door.leaves.push({ pivot, sd });
    interactives.push({ obj: pivot, kind: 'door', label: '点击 · 推开大门' });
  }
  const fr = winGeo(W * 2, H).frame; put('trim', fr, TM(0, F, -3)); put('gold', sphGeo(0.32, 12, 8), TM(0, F + H + 0.35, -2.9));
}
/* ---------- mermaid princess hologram: the creator's cut-out art projected as light ---------- */
function buildHolo(){
  const g = new THREE.Group();
  const Hh = 5.3, BASE = 0.3;
  // the mermaid princess (ref 1) as a Tripo mesh, drawn as light instead of matter
  const model = fitTripo(T3.mermaid, Hh, { glow: 0, caustic: false }); model.position.y = BASE;
  const Ww = model.userData.size.x; let map = null; model.traverse(o => { if (o.isMesh && o.material.map) map = o.material.map; });
  const hu = { uMap: { value: map }, uTime: U.uTime, uGlitch: { value: 0 }, uSing: { value: 0 }, uY0: { value: 0 }, uH: { value: Hh } };
  const VS = `uniform float uTime, uGlitch, uY0, uH; varying vec2 vUv; varying vec3 vN, vV; varying float vh;
    void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vh = (w.y - uY0) / uH;
      float seg = floor(vh * 46.0), tick = floor(uTime * 7.0);
      float jump = step(0.955 - uGlitch * 0.35, fract(sin(seg * 17.13 + tick * 3.7) * 4375.85));
      w.x += jump * (0.04 + uGlitch * 0.32) * sin(seg * 9.1 + tick);
      vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const holoMat = new THREE.ShaderMaterial({ uniforms: hu, transparent: true, depthWrite: false, fog: false, vertexShader: VS,
    fragmentShader: `uniform sampler2D uMap; uniform float uTime, uGlitch, uSing, uH; varying vec2 vUv; varying vec3 vN, vV; varying float vh;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        vec3 tex = texture2D(uMap, vUv).rgb; float lum = dot(tex, vec3(0.3, 0.59, 0.11));
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec3 cyan = vec3(0.36, 0.9, 1.0), violet = vec3(0.66, 0.6, 1.0);
        vec3 tint = mix(cyan, violet, smoothstep(0.15, 0.6, 1.0 - vh) * 0.7);            // lilac fin, cyan hair (ref 1)
        vec3 col = tint * (0.3 + lum * 1.25) + tex * tint * 0.55;
        float scan = 0.62 + 0.38 * sin(vh * uH * 70.0 - uTime * 6.0);
        float grid = smoothstep(0.92, 1.0, abs(sin(vh * uH * 9.0))) * 0.5;   // bright tech contour bands
        float fine = 0.9 + 0.1 * sin(gl_FragCoord.y * 1.6);
        float sweep = exp(-pow((fract(vh * 0.85 - uTime * 0.17) - 0.5) * 24.0, 2.0));
        col = col * scan * fine * (1.0 + uSing * 0.6) + cyan * (fr * 2.2 + sweep * 1.1 + grid) * (1.0 + uSing);
        float flick = 0.9 + 0.1 * sin(uTime * 23.0) * sin(uTime * 7.3) - uGlitch * 0.3 * h1(floor(uTime * 30.0));
        float a = (0.58 + lum * 0.22 + fr * 0.6 + sweep * 0.3 + grid * 0.4) * flick * smoothstep(0.0, 0.05, vh);
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
      }` });
  // depth-only twin (same glitch) so we see one clean hologram surface, not its insides
  const depthMat = new THREE.ShaderMaterial({ uniforms: hu, colorWrite: false, vertexShader: VS, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }' });
  const card = new THREE.Group();
  const hm = []; model.traverse(o => { if (o.isMesh) hm.push(o); });
  hm.forEach(o => { o.castShadow = false; o.receiveShadow = false;
    const pre = new THREE.Mesh(o.geometry, depthMat); pre.renderOrder = 6; pre.frustumCulled = false; o.parent.add(pre); pre.position.copy(o.position); pre.quaternion.copy(o.quaternion); pre.scale.copy(o.scale);
    o.material = holoMat; o.renderOrder = 7; o.frustumCulled = false; });
  card.add(model);
  const pivot = new THREE.Group(); pivot.add(card); g.add(pivot);
  // projector: silver disc, glowing rings, light column, rising motes, orbiting data rings
  const metal = new THREE.MeshStandardMaterial({ color: 0xdfe8f2, roughness: 0.25, metalness: 0.85 });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.24, 48), metal); disc.position.y = 0.12; disc.castShadow = disc.receiveShadow = true; g.add(disc);
  const glowM = new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.95, fog: false });
  for (const [r, y] of [[1.18, 0.25], [0.78, 0.25], [1.43, 0.06]]){ const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 64), glowM); t.rotation.x = Math.PI / 2; t.position.y = y; g.add(t); }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.72, 40), new THREE.MeshBasicMaterial({ color: 0xc8fbff, fog: false })); lens.rotation.x = -Math.PI / 2; lens.position.y = 0.245; g.add(lens);
  const beamU = { uTime: U.uTime };
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(Ww * 0.62, 1.05, Hh + 0.6, 48, 1, true).translate(0, (Hh + 0.6) / 2 + 0.24, 0), new THREE.ShaderMaterial({
    uniforms: beamU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime; varying vec2 vUv; void main(){ float streak = 0.55 + 0.45 * sin(vUv.x * 120.0 + uTime * 1.5) * sin(vUv.x * 37.0 - uTime);
      float a = pow(1.0 - vUv.y, 2.2) * 0.2 * streak; gl_FragColor = vec4(vec3(0.45, 0.9, 1.0) * a, a); }` }));
  beam.renderOrder = 6; g.add(beam);
  const N = 140, mp = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push([Math.random() * TAU, 0.2 + Math.random() * 1.2, Math.random() * Hh, 0.4 + Math.random() * 0.8]);
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: 0xa8f4ff, size: 0.07, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); motes.frustumCulled = false; g.add(motes);
  const rings = [];
  for (const [y, r] of [[1.6, 1.55], [3.9, 1.25]]){ const rg = new THREE.Mesh(new THREE.TorusGeometry(r, 0.012, 4, 96, Math.PI * 1.6), glowM); rg.position.y = y; rg.rotation.x = Math.PI / 2 - 0.12; g.add(rg); rings.push(rg); }
  const hit = new THREE.Mesh(new THREE.BoxGeometry(Ww * 0.8, Hh, 1.2).translate(0, Hh / 2 + BASE, 0), new THREE.MeshBasicMaterial({ visible: false })); g.add(hit);
  g.userData = { hu, pivot, motes, seeds, rings, hit, H: Hh, W: Ww, glitch: 0, top: Hh + BASE + 0.4, side: new THREE.Vector3(Ww * 0.3, BASE + Hh * 0.8, 0.2) };
  return g;
}
const _hp = new THREE.Vector3();
function updateHolo(dt, t){
  const h = props.holo; if (!h) return;
  h.glitch = Math.max(0, h.glitch - dt * 0.9); h.hu.uGlitch.value = h.glitch * h.glitch;
  song.level += (songLevel() - song.level) * Math.min(1, dt * 10);
  h.hu.uSing.value = song.level; h.sing = (h.sing || 0) + ((song.on ? 1 : 0) - (h.sing || 0)) * Math.min(1, dt * 2);
  // face the viewer, within a cone so the card never slices into the shell behind it
  h.pivot.getWorldPosition(_hp); h.hu.uY0.value = _hp.y + 0.3; const yaw = Math.atan2(camera.position.x - _hp.x, camera.position.z - _hp.z); h.pivot.rotation.y = clamp(yaw, -0.85, 0.85); h.pivot.rotation.z = Math.sin(t * 1.6) * 0.035 * h.sing; h.pivot.position.y = Math.sin(t * 2.2) * 0.08 * h.sing;
  const a = h.motes.geometry.attributes.position.array;
  h.seeds.forEach(([ang, r, y0, sp], i) => { const y = (y0 + t * sp * (1 + h.sing * 1.5)) % h.H; a[i * 3] = Math.cos(ang + t * 0.3) * r; a[i * 3 + 1] = 0.3 + y; a[i * 3 + 2] = Math.sin(ang + t * 0.3) * r; });
  h.motes.geometry.attributes.position.needsUpdate = true;
  h.rings[0].rotation.z = t * 0.5; h.rings[1].rotation.z = -t * 0.7;
}

/* =====================================================================
   6c. Seabed sites: the telephone booth with goldfish (ref 9) and the crystal-coral swing (ref 10)
   ===================================================================== */
const pendingSchools = [];
const BOOTH = { x: -27, z: 141 }, SWING = { x: 31, z: 139 };
function sitePads(){
  BOOTH.top = natural(BOOTH.x, BOOTH.z) + 0.3; SWING.top = natural(SWING.x, SWING.z) + 0.2;
  padC(BOOTH.x, BOOTH.z, 4.4, BOOTH.top, { drop: 0.5, slope: 0.45, range: 7 });
  padC(SWING.x, SWING.z, 7.0, SWING.top, { drop: 0.25, slope: 0.35, range: 7 });
  clearSpots.push([BOOTH.x, BOOTH.z, 9.5], [SWING.x, SWING.z, 9.5]);
  for (const dz of [-6, 0, 6]) clearSpots.push([riverX(BOAT.z + dz), BOAT.z + dz, 7.5]);   // open water around the 猫糕 boat
}
function glowCoral(x, y, z, col, s = 1){
  const parts = [], rnd = seededRand(Math.floor(Math.abs(x * 31 + z * 17) + 999)), V = (a, b, c) => new THREE.Vector3(a, b, c);
  const grow = (p, d, len, r, depth) => { const e = p.clone().addScaledVector(d, len); parts.push(limb(p.toArray(), e.toArray(), r, r * 0.75, 7)); const sp = new THREE.SphereGeometry(r * 0.8, 7, 5); sp.translate(e.x, e.y, e.z); parts.push(sp);
    if (depth > 0) for (let k = 0; k < 2; k++){ const nd = d.clone().add(V(rnd(-0.7, 0.7), rnd(0.3, 0.8), rnd(-0.7, 0.7))).normalize(); grow(e, nd, len * rnd(0.6, 0.8), r * 0.72, depth - 1); } };
  for (let k = 0; k < 4; k++) grow(V(rnd(-0.2, 0.2), 0, rnd(-0.2, 0.2)), V(rnd(-0.4, 0.4), 1, rnd(-0.4, 0.4)).normalize(), rnd(0.5, 0.8), 0.09, 3);
  const g = mergeNI(parts.map(p => { const q = p.index ? p.toNonIndexed() : p; for (const k of Object.keys(q.attributes)) if (!['position', 'normal'].includes(k)) q.deleteAttribute(k); return q; }));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.4, roughness: 0.25, transparent: true, opacity: 0.9 }));
  m.position.set(x, y, z); m.scale.setScalar(s); scene.add(m); return m;
}
function signTexture(text){
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const g = cv.getContext('2d');
  g.fillStyle = '#fff3d6'; g.fillRect(0, 0, 512, 96); g.strokeStyle = '#c99a4a'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 80);
  g.fillStyle = '#5a3a1a'; g.font = '600 54px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 52);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function buildBooth(){
  const { x, z, top } = BOOTH, ry = Math.atan2(0 - x, 152 - z), S = 1.85;
  band('trim', x, z, 0, 2.3 * S, top - 1.6, top); band('marble', x, z, 2.05 * S, 2.35 * S, top - 0.06, top + 0.04);
  const grp = new THREE.Group(); grp.position.set(x, top, z); grp.rotation.y = ry; grp.scale.setScalar(S); scene.add(grp);
  const teal = patch(new THREE.MeshStandardMaterial({ color: 0x8cd6d0, roughness: 0.36, metalness: 0.06 }));
  const pale = patch(new THREE.MeshStandardMaterial({ color: 0xe4f6f2, roughness: 0.4 }));
  const glass = new THREE.MeshStandardMaterial({ color: 0x6a5032, roughness: 0.1, metalness: 0.1, emissive: 0xffc47e, emissiveIntensity: 0.9, transparent: true, opacity: 0.86 });
  const signT = signTexture('TELEPHONE');
  const signM = new THREE.MeshStandardMaterial({ map: signT, emissive: 0xffe6bb, emissiveMap: signT, emissiveIntensity: 0.75, roughness: 0.5 });
  const B = (m, w, h, d, px, py, pz, parent = grp) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(px, py, pz); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
  const W = 1.7, H = 3.3, h0 = 0.24, HT = h0 + H;
  B(pale, 2.12, h0, 2.12, 0, h0 / 2, 0); B(teal, 2.0, 0.06, 2.0, 0, h0 + 0.03, 0);
  // fluted corner posts with capitals
  for (const sx of [-1, 1]) for (const sz of [-1, 1]){
    B(teal, 0.24, H, 0.24, sx * 0.86, h0 + H / 2, sz * 0.86);
    for (const [fx, fz] of [[0.125, 0], [0, 0.125]]) B(pale, fx ? 0.012 : 0.05, H - 0.4, fz ? 0.012 : 0.05, sx * 0.86 + sx * fx, h0 + H / 2, sz * 0.86 + sz * fz);
    B(pale, 0.3, 0.1, 0.3, sx * 0.86, HT - 0.05, sz * 0.86);
  }
  // window wall: kick panel, 3 x 8 glowing panes with muntins (local frame faces +z)
  const side = (parent, g) => {
    B(teal, 1.5, 0.52, 0.08, 0, h0 + 0.26, 0, parent); B(pale, 1.1, 0.3, 0.02, 0, h0 + 0.26, 0.045, parent);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 2.5), g); pane.position.set(0, h0 + 0.52 + 1.25, -0.01); parent.add(pane);
    for (let r = 0; r <= 8; r++) B(teal, 1.5, r % 8 ? 0.05 : 0.09, 0.07, 0, h0 + 0.52 + r * 2.5 / 8, 0, parent);
    for (let c = 0; c <= 3; c++) B(teal, c % 3 ? 0.05 : 0.09, 2.5, 0.07, -0.72 + c * 1.44 / 3, h0 + 0.52 + 1.25, 0, parent);
    B(teal, 1.5, 0.22, 0.08, 0, h0 + 3.13, 0, parent);
  };
  for (const [a, px, pz] of [[Math.PI, 0, -0.84], [Math.PI / 2, 0.84, 0], [-Math.PI / 2, -0.84, 0]]){ const sg = new THREE.Group(); sg.position.set(px, 0, pz); sg.rotation.y = a; grp.add(sg); side(sg, glass); }
  const doorPivot = new THREE.Group(); doorPivot.position.set(-0.74, 0, 0.86); grp.add(doorPivot);
  const leaf = new THREE.Group(); leaf.position.set(0.74, 0, 0); doorPivot.add(leaf); side(leaf, glass);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), mats.gold); handle.position.set(0.56, h0 + 1.6, 0.08); leaf.add(handle);
  // header with illuminated TELEPHONE signs on all four faces
  B(teal, 2.04, 0.52, 2.04, 0, HT + 0.26, 0);
  for (const [a, px, pz] of [[0, 0, 1.03], [Math.PI, 0, -1.03], [Math.PI / 2, 1.03, 0], [-Math.PI / 2, -1.03, 0]]){
    const sgn = new THREE.Mesh(new THREE.PlaneGeometry(1.56, 0.32), signM); sgn.position.set(px, HT + 0.26, pz); sgn.rotation.y = a; grp.add(sgn); }
  B(pale, 2.14, 0.08, 2.14, 0, HT + 0.56, 0);
  // arched pediments on every face + domed roof that meets them (K6 kiosk silhouette)
  const RISE = 0.46, Y0 = HT + 0.6, A = 1.06;
  { const sh = new THREE.Shape(); sh.moveTo(-A, 0); sh.lineTo(A, 0); sh.absellipse(0, 0, A, RISE, 0, Math.PI, false); sh.lineTo(-A, 0);
    const pg = new THREE.ExtrudeGeometry(sh, { depth: 0.08, bevelEnabled: false, curveSegments: 32 });
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]){ const m = new THREE.Mesh(pg, teal); m.position.set(Math.sin(a) * (A - 0.02), Y0, Math.cos(a) * (A - 0.02)); m.rotation.y = a; m.castShadow = true; grp.add(m);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, 40, Math.PI), pale); rim.scale.set(A, RISE, 1); rim.position.set(Math.sin(a) * (A + 0.04), Y0, Math.cos(a) * (A + 0.04)); rim.rotation.y = a; grp.add(rim); }
    const rg = new THREE.PlaneGeometry(2 * A, 2 * A, 40, 40); rg.rotateX(-Math.PI / 2); const rp = rg.attributes.position;
    for (let i = 0; i < rp.count; i++){ const px = rp.getX(i) / A, pz = rp.getZ(i) / A, mn = Math.min(Math.abs(px), Math.abs(pz)), r2 = (px * px + pz * pz) / 2;
      rp.setY(i, RISE * Math.sqrt(Math.max(0, 1 - mn * mn)) + 0.16 * (1 - r2)); }
    rg.computeVertexNormals(); const roof = new THREE.Mesh(rg, teal); roof.position.y = Y0; roof.castShadow = true; grp.add(roof); }
  // gilded crown emblem on the front and back pediments + finial
  const crownAt = (px, py, pz, a) => { const c = new THREE.Group(); c.position.set(px, py, pz); c.rotation.y = a; grp.add(c);
    c.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 0.04), mats.gold));
    for (let k = -2; k <= 2; k++){ const sp = new THREE.Mesh(new THREE.ConeGeometry(0.03, k ? 0.13 : 0.18, 6), mats.gold); sp.position.set(k * 0.075, 0.1 + (k ? 0 : 0.02), 0); c.add(sp);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mats.gold); orb.position.set(k * 0.075, k ? 0.17 : 0.21, 0); c.add(orb); }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 20, Math.PI), mats.gold); arch.position.y = 0.04; c.add(arch); };
  crownAt(0, Y0 + 0.14, A + 0.1, 0); crownAt(0, Y0 + 0.14, -A - 0.1, Math.PI);
  { const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), mats.gold); f.position.y = Y0 + RISE + 0.24; grp.add(f); }
  // interior: wall telephone, shelf, directory, lamp
  const phone = new THREE.Group(); phone.position.set(0, h0 + 1.55, -0.7); grp.add(phone);
  const black = new THREE.MeshStandardMaterial({ color: 0x17161a, roughness: 0.35, metalness: 0.4 });
  const ph = (geo, m, px, py, pz, rx = 0, ry2 = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(px, py, pz); o.rotation.set(rx, ry2, rz); phone.add(o); return o; };
  ph(new THREE.BoxGeometry(0.4, 0.5, 0.16), black, 0, 0, 0);
  ph(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 24), mats.gold, 0, 0.02, 0.09, Math.PI / 2);
  ph(new THREE.TorusGeometry(0.085, 0.012, 6, 20), black, 0, 0.02, 0.11);
  ph(new THREE.BoxGeometry(0.06, 0.06, 0.06), mats.gold, 0.24, 0.18, 0.04);
  const hs = new THREE.Group(); hs.position.set(0.0, 0.33, 0.08); phone.add(hs);
  hs.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 10).rotateZ(Math.PI / 2), black));
  for (const sx of [-1, 1]){ const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), black); e.scale.set(1, 0.7, 1); e.position.set(sx * 0.21, -0.02, 0); hs.add(e); }
  const cord = []; for (let k = 0; k <= 30; k++){ const t = k / 30; cord.push(new THREE.Vector3(-0.2 + Math.sin(t * 40) * 0.025, 0.28 - t * 0.55, 0.1 + Math.cos(t * 40) * 0.025)); } ph(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cord), 90, 0.008, 4, false), black, 0, 0, 0);
  B(pale, 1.2, 0.06, 0.4, 0, h0 + 0.95, -0.6);
  B(new THREE.MeshStandardMaterial({ color: 0x8a2a2a, roughness: 0.7 }), 0.32, 0.08, 0.24, -0.25, h0 + 1.02, -0.6);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshStandardMaterial({ color: 0xfff1d2, emissive: 0xffb86a, emissiveIntensity: 1.2 })); bulb.position.set(0, HT - 0.15, 0); grp.add(bulb);
  const light = new THREE.PointLight(0xffb866, 6, 18, 1.6); light.position.set(0, HT - 0.4, 0.1); grp.add(light);
  props.booth = { grp, doorPivot, phone, glass, bulb, light, open: 0, t: 0, lit: 0, ring: 0, ry };
  interactives.push({ obj: grp, kind: 'booth', label: '点击 · 推开电话亭' });
  obst(x, z, 1.35 * S, top - 1, top + 9);
  // rising bubbles beside the booth
  { const N = 70, pos = new Float32Array(N * 3), seed = []; for (let k = 0; k < N; k++){ seed.push([R(-2.6, 2.6), R(-2.6, 2.6), R(0.6, 1.6), R(0, 9)]); }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xe8fbff, size: 0.22, transparent: true, opacity: 0.75, depthWrite: false })); pts.frustumCulled = false; scene.add(pts);
    props.bubbles = { bg, seed, x, z, y: top }; }
  // pink flowering bushes framing the booth (ref 1) and clownfish
  for (let k = 0; k < 30; k++){ const a = ry + Math.PI + mix(-2.3, 2.3, k / 29) + R(-0.1, 0.1), d = R(5.0, 8.6); const bx = x + Math.sin(a) * d, bz = z + Math.cos(a) * d; plantLists.bush.push({ x: bx, y: terrainH(bx, bz) - 0.2, z: bz, r: R(0, TAU), s: R(1.4, 2.3), c: new THREE.Color(pick([0xffb0c8, 0xff9ab8, 0xffc8d8, 0xf6a0c0])) }); }
  const gy = top + 4.2;
  pendingSchools.push({ sp: 'clown', n: 16, s: 0.55, f: t => [x + Math.cos(-t * 0.16) * 7.5, gy + Math.sin(t * 0.3) * 1.6, z + Math.sin(-t * 0.16) * 6.5], sp3: [2.4, 1.6, 2.4] });
}
function buildSwing(){
  const { x, z, top } = SWING, ry = Math.atan2(BOOTH.x - x, BOOTH.z - z);   // faces the telephone booth; swings straight toward it and back
  const grp = new THREE.Group(); grp.position.set(x, top, z); grp.rotation.y = ry; scene.add(grp);
  const crystal = new THREE.MeshPhysicalMaterial({ color: 0x7ccfff, emissive: 0x2a86ff, emissiveIntensity: 0.95, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.84, iridescence: 0.7, iridescenceIOR: 1.4, clearcoat: 1.0 });
  crystal.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      { float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2); totalEmissiveRadiance += vec3(0.55, 0.88, 1.0) * fr * 1.9; }`); };
  crystal.customProgramCacheKey = () => 'crystal-fresnel';
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  const trunk = varTube([V(-3.6, -0.3, 0.3), V(-3.3, 2.0, 0.0), V(-2.9, 4.2, -0.2), V(-2.4, 6.0, 0.0), V(-1.3, 6.85, 0.05), V(0.6, 7.05, 0.0), V(2.3, 6.9, 0.05), V(3.6, 7.4, 0.0)], t => mix(0.78, 0.2, Math.pow(t, 0.7)), 80, 14);
  const tree = gTree.scene;
  tree.traverse(o => { if(o.isMesh){o.material=crystal;o.castShadow=true;o.receiveShadow=true;} });
  grp.add(tree);
  // sparkles
  // aurora-coloured water under the swing (was white sand)
  { const sg = new THREE.CircleGeometry(7.2, 48, 0, TAU); sg.rotateX(-Math.PI / 2); const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++){ const wx = x + p.getX(i), wz = z + p.getZ(i); p.setY(i, Math.max(0.02, terrainH(wx, wz) - top + 0.06)); }   // flat water, wet edges hug the ground
    sg.computeVertexNormals(); const pool = new THREE.Mesh(sg, auroraPoolMat(x, z, 7.2)); pool.position.set(x, top + 0.04, z); pool.renderOrder = 2; pool.name = 'auroraPool'; scene.add(pool); }
  const sp = []; for (let k = 0; k < 260; k++){ const t = rand(), p = trunk.curve.getPointAt(t); sp.push(p.x + R(-1.5, 1.5), p.y + R(-0.5, 2.0), p.z + R(-1.2, 1.2)); }
  const spG = new THREE.BufferGeometry(); spG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  grp.add(new THREE.Points(spG, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
  // swing: pivot under the branch, ropes, glass crescent seat with vines
  const L = 5.85, pivot = new THREE.Group(); pivot.position.set(0.2, 6.85, 0); grp.add(pivot);
  const rope = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.9 });
  for (const sx of [-0.62, 0.62]){ const r = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, L - 0.1, 8), rope); r.position.set(sx, -L / 2, 0); pivot.add(r);
    for (let k = 0; k < 9; k++){ const lf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshStandardMaterial({ color: 0x6fd08a, roughness: 0.6 })); lf.scale.set(1.6, 0.5, 0.9); lf.position.set(sx + (k % 2 ? 0.05 : -0.05), -0.6 - k * 0.55, 0.02); lf.rotation.z = k % 2 ? 0.6 : -0.6; pivot.add(lf); } }
  // vines spiralling up both ropes
  for (const sx of [-0.62, 0.62]){ const vp = []; for (let k = 0; k <= 80; k++){ const t = k / 80; vp.push(V(sx + Math.cos(t * 40) * 0.07, -0.4 - t * (L - 0.9), Math.sin(t * 40) * 0.07)); }
    pivot.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(vp), 200, 0.018, 5, false), new THREE.MeshStandardMaterial({ color: 0x5cc07a, roughness: 0.6, emissive: 0x0f3a1a, emissiveIntensity: 0.4 }))); }
  // glass crescent seat (ref 3)
  const cres = new THREE.Shape(); cres.moveTo(-0.85, 0.42); cres.quadraticCurveTo(0, -0.5, 0.85, 0.42); cres.quadraticCurveTo(0.8, 0.5, 0.72, 0.44); cres.quadraticCurveTo(0, -0.22, -0.72, 0.44); cres.quadraticCurveTo(-0.8, 0.5, -0.85, 0.42);
  const seatG = new THREE.ExtrudeGeometry(cres, { depth: 0.8, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 4, curveSegments: 28 }); seatG.translate(0, 0, -0.4);
  const seat = new THREE.Mesh(seatG, new THREE.MeshPhysicalMaterial({ color: 0xeaf8ff, emissive: 0x6ac8ff, emissiveIntensity: 0.45, roughness: 0.04, transparent: true, opacity: 0.62, iridescence: 1.0, clearcoat: 1, side: THREE.DoubleSide }));
  seat.position.set(0, -L - 0.05, 0); pivot.add(seat);
  props.swing = { grp, pivot, L, ride: false, amp: 0.05, ph: 0, ry };
  interactives.push({ obj: grp, kind: 'swing', label: '点击 · 荡秋千' });
  obst(...(() => { const p = new THREE.Vector3(-3.5, 0, 0.2).applyAxisAngle(_ya, ry); return [x + p.x, z + p.z]; })(), 1.0, top - 1, top + 8);
  // colourful reef garden around the sand (outside the swing's arc)
  for (let k = 0; k < 90; k++){ const a = rand() * TAU, d = R(4.6, 9.5), lx = Math.sin(a) * d, lz = Math.cos(a) * d; if (Math.abs(lz) < 3.6 && Math.abs(lx) < 2.4) continue; if (lz > 0 && Math.abs(lx) < 3.4) continue;   // keep the rider's view to the river clear
    const p = new THREE.Vector3(lx, 0, lz).applyAxisAngle(_ya, ry), px = x + p.x, pz = z + p.z; plantOne(px, terrainH(px, pz) - 0.1, pz, R(1.0, 1.7)); }
  // hero corals around the clearing: violet anemone, orange tube coral, yellow lobe coral, red branching coral
  const loc = (lx, lz) => { const p = new THREE.Vector3(lx, 0, lz).applyAxisAngle(_ya, ry); const px = x + p.x, pz = z + p.z; return [px, terrainH(px, pz), pz]; };
  for (const [lx, lz, kind, sc, col] of [[-5.2, 4.6, 'anem', 3.0, 0xd46cf0], [-6.6, 2.0, 'tube', 2.8, 0xff6a2a], [5.6, 4.8, 'brain', 2.7, 0xffd84a], [7.0, 1.6, 'coral1', 3.4, 0xff4f6d],
      [-7.4, -2.5, 'coral2', 3.0, 0xff7ac8], [6.8, -3.4, 'fan', 3.0, 0xff8f70], [-6.4, -5.4, 'brain', 2.0, 0xd0a8ff], [6.0, -5.6, 'anem', 2.2, 0xff8fb0], [0.5, -7.6, 'glow', 2.0, 0x7ff6ff]]){
    const [px, py, pz] = loc(lx, lz); plantLists[kind].push({ x: px, y: py - 0.15, z: pz, r: R(0, TAU), s: sc, c: new THREE.Color(col) }); }
  pendingSchools.push({ sp: 'clown', n: 10, s: 0.6, f: t => [x + Math.cos(t * 0.2) * 5.5, top + 3.2 + Math.sin(t * 0.5) * 0.8, z + Math.sin(t * 0.2) * 4.5], sp3: [1.6, 0.8, 1.6] });
  pendingSchools.push({ sp: 'tang', n: 5, s: 0.6, f: t => [x + Math.cos(-t * 0.14 + 2) * 7, top + 4.5, z + Math.sin(-t * 0.14 + 2) * 6], sp3: [2, 1, 2] });
}
/** stone steps from the front landing down to the open seabed */
function addLandingSteps(){
  const y0 = 0, x0 = 0, z0 = 135.3, z1 = 141.5, y1 = terrainH(0, z1 + 0.5) + 0.05, n = Math.max(3, Math.round((y0 - y1) / 0.26));
  for (let i = 0; i < n; i++){ const t0 = i / n, t1 = (i + 1) / n, topY = mix(y0, y1, t1), zc = mix(z0, z1, (t0 + t1) / 2); boxB('marble', x0, topY - 2.5, zc, 5.4, 2.5, (z1 - z0) / n + 0.02); }
  zoneSeg(0, z0 - 0.6, 0, z1 + 0.4, 2.3, y0, y1);
}
function bushGeo(){
  const parts = [], rnd = seededRand(66);
  for (let k = 0; k < 9; k++){ const s = new THREE.IcosahedronGeometry(rnd(0.28, 0.42), 1); s.translate(rnd(-0.45, 0.45), rnd(0.25, 0.75), rnd(-0.45, 0.45)); parts.push(tint(s, (x, y, z, c) => c.setRGB(0.32, 0.95, 0.45))); }
  for (let k = 0; k < 110; k++){ const a = rnd(0, TAU), e = rnd(0.1, 1.4), r = rnd(0.45, 0.64); const f = new THREE.IcosahedronGeometry(rnd(0.07, 0.12), 0); f.translate(Math.cos(a) * Math.sin(e) * r, 0.5 + Math.cos(e) * r * 0.8, Math.sin(a) * Math.sin(e) * r); parts.push(flatTint(f, 1.15, 1.1, 1.1)); }
  return mergeC(parts);
}

/* =====================================================================
   10. Build everything & bake static batches
   ===================================================================== */
buildCourt(); buildT1(); await tick(72, '正在铺设大理石广场……');
buildPalace(); buildDistrict(); buildWings(); sitePads(); await tick(78, '正在搭建宫殿与图书馆……');
buildTerrain(); addLandingSteps(); buildRivers(); await tick(84, '正在引入粉色河水……');
buildBooth(); buildSwing(); buildReef(); buildFarCity(); buildTornadoes(); buildPets(); buildDucks(); buildShells(); buildBoat(); await tick(90, '正在种下珊瑚花园……');


for (const [name, list] of Object.entries(BK)){
  const g = mergeGeometries(list, false);
  const m = new THREE.Mesh(g, mats[name]); m.name = name;
  m.castShadow = name !== 'glass'; m.receiveShadow = true; m.frustumCulled = false;
  scene.add(m);
}
{ // balusters
  const pts = [[0.075, 0.12], [0.1, 0.17], [0.065, 0.25], [0.125, 0.42], [0.075, 0.64], [0.05, 0.71], [0.095, 0.8], [0.095, 0.86]].map(p => new THREE.Vector2(p[0], p[1]));
  const m = new THREE.InstancedMesh(new THREE.LatheGeometry(pts, LOW ? 5 : 7), mats.trim, balM.length);
  balM.forEach((mm, i) => m.setMatrixAt(i, mm)); m.receiveShadow = true; m.frustumCulled = false; scene.add(m);
}
const lampMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 14, 10), mats.lamp, lampPts.length);
lampPts.forEach((p, i) => lampMesh.setMatrixAt(i, TM(p[0], p[1], p[2])));
lampMesh.frustumCulled = false; scene.add(lampMesh);
const waterMesh = new THREE.Mesh(mergeGeometries(waterGeos.map(g => g.index ? g.toNonIndexed() : g)), mats.water);
waterMesh.name = 'water'; waterMesh.receiveShadow = true; waterMesh.renderOrder = 2; scene.add(waterMesh);

/* =====================================================================
   11. Lights
   ===================================================================== */
const hemi = new THREE.HemisphereLight(0xc8f4ff, 0x24505a, 1.1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0d4, 3.2);
sun.castShadow = true; sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -185, right: 185, top: 185, bottom: -185, near: 20, far: 1000 });
sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.12;
sun.target.position.set(0, 0, 0); scene.add(sun, sun.target);
const pLights = PL.map(([x, y, z]) => { const l = new THREE.PointLight(0xffb867, 0, 46, 2); l.position.set(x, y, z); scene.add(l); return l; });

/* =====================================================================
   12. Sky / sea surface / god rays / particles / halos
   ===================================================================== */
const SEA_Y = 330;
const SKY_VS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; gl_Position.z = gl_Position.w * 0.99999; }`;
const SKY_FS = `uniform vec3 uTop, uMid, uBot, uSunDir, uSunCol, uSea; uniform float uFlash, uTime, uStorm, uSeaI, uSeaY;
varying vec3 vW;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){ vec3 d = normalize(vW - cameraPosition); float y = d.y;
  vec3 c = y > 0.0 ? mix(uMid, uTop, pow(clamp(y, 0.0, 1.0), 0.85)) : mix(uMid, uBot, pow(clamp(-y, 0.0, 1.0), 0.55));
  float s = max(dot(d, normalize(uSunDir)), 0.0); c += uSunCol * (pow(s, 10.0) * 0.28 + pow(s, 70.0) * 0.36);
  if (y > 0.0){
    float t = min((uSeaY - cameraPosition.y) / max(y, 1e-3), 30000.0);
    vec2 p = cameraPosition.xz + d.xz * t; float sp = 1.0 + uStorm * 4.0;
    float w1 = vn(p * 0.018 + uTime * vec2(0.03, 0.02) * sp), w2 = vn(p * 0.055 - uTime * vec2(0.05, 0.04) * sp);
    float waves = w1 * 0.6 + w2 * 0.4;
    float net = pow(1.0 - abs(sin(p.x * 0.045 + w1 * 3.0 + uTime * 0.2) * sin(p.y * 0.045 + w2 * 3.0 - uTime * 0.17)), 7.0);
    vec2 sunP = cameraPosition.xz + uSunDir.xz / max(uSunDir.y, 0.2) * (uSeaY - cameraPosition.y);
    float sw = exp(-length(p - sunP) / 240.0);
    vec3 col = uSea * (0.5 + 0.5 * waves) * uSeaI + uSea * net * 0.4 * uSeaI + vec3(1.0, 0.97, 0.9) * sw * uSeaI * 0.85 * (1.0 - uStorm * 0.8);
    float cl = vn(p * 0.006 + uTime * 0.025 * vec2(1.0, 0.6)) * vn(p * 0.017 - uTime * 0.06);
    col *= mix(1.0, 0.32 + 0.45 * cl, uStorm);
    if (uStorm > 0.01){ vec2 g = p * 0.11; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float tt = fract(uTime * 0.9 + h21(id)); float dd = length(f + (vec2(h21(id + 3.0), h21(id + 7.0)) - 0.5) * 0.5); col += smoothstep(0.05, 0.0, abs(dd - tt * 0.45)) * (1.0 - tt) * 0.16 * uStorm * uSea; }
    col += uFlash * vec3(0.5, 0.55, 0.64) * (0.4 + 0.6 * cl);
    float vis = exp(-t / 1500.0) * smoothstep(0.02, 0.35, y);
    c = mix(c, col, vis);
  }
  c += uFlash * vec3(0.22, 0.25, 0.3) * smoothstep(-0.2, 0.6, y);
  gl_FragColor = vec4(c, 1.0); }`;
const skyU = { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBot: { value: new THREE.Color() }, uSunDir: U.uSunDir, uSunCol: { value: new THREE.Color() }, uFlash: { value: 0 },
  uSea: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uTime: U.uTime, uStorm: { value: 0 }, uSeaI: { value: 1 }, uSeaY: { value: SEA_Y } };
const seaU = skyU;
const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 64, 32), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false }));
sky.name = 'sky'; sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);
// env for metal/stone reflections
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false })));
let envRT = null;
function updateEnv(){ const rt = pmrem.fromScene(envScene, 0.03); if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture; }

// god rays (Tyndall shafts), a few with prismatic rainbow refraction
const rayU = { uColor: { value: new THREE.Color() }, uI: { value: 0.2 }, uRainbow: { value: 0.6 }, uTime: U.uTime };
const rayGeo = new THREE.CylinderGeometry(1, 1.7, 1, 20, 1, true); rayGeo.translate(0, -0.5, 0);
const RAY_T = [[-62, 38], [42, 70], [-22, -42], [96, 8], [16, 122], [-88, 74], [4, -16]];
const rays = RAY_T.map(([x, z], i) => {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...rayU, uSeed: { value: rand() }, uRb: { value: i === 1 || i === 5 ? 1 : 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI, uTime, uRainbow, uSeed, uRb; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vD;
      vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        float along = smoothstep(0.0, 0.5, vUv.y) * (0.5 + 0.5 * vUv.y);
        float fl = 0.72 + 0.28 * sin(uTime * 0.45 + uSeed * 6.28 + vUv.y * 2.5);
        vec3 c = uColor; float rb = uRainbow * uRb;
        if (rb > 0.0){ c = mix(c, hue(fract(vN.x * 0.42 + 0.55 + vUv.y * 0.12)) * 1.25, rb * 0.75); }
        float a = edge * along * fl * uI * smoothstep(10.0, 70.0, vD) * (uRb > 0.5 ? 1.25 : 1.0);
        gl_FragColor = vec4(c, a); }`
  });
  const m = new THREE.Mesh(rayGeo, mat); m.name = 'rays'; m.frustumCulled = false; m.renderOrder = 5; m.userData = { x, z, w: R(9, 20), ph: rand() * TAU }; scene.add(m); return m;
});
const _up = new THREE.Vector3(0, 1, 0);
function updateRays(t){
  const d = U.uSunDir.value; const q = new THREE.Quaternion().setFromUnitVectors(_up, d);
  const L = (SEA_Y + 40) / Math.max(d.y, 0.2);
  for (const r of rays){
    const u = r.userData; const tx = u.x + Math.sin(t * 0.05 + u.ph) * 6, tz = u.z + Math.cos(t * 0.04 + u.ph) * 6;
    const k = (SEA_Y - 0) / Math.max(d.y, 0.2);
    r.position.set(tx + d.x * k, SEA_Y, tz + d.z * k); r.quaternion.copy(q); r.scale.set(u.w, L, u.w);
  }
}

// drifting bioluminescent plankton
const PCOUNT = 2600;
const partU = { uDrift: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(500, 210, 480) }, uOrigin: { value: new THREE.Vector3(-250, -30, -230) }, uTime: U.uTime, uPix: { value: renderer.getPixelRatio() }, uColor: { value: new THREE.Color() }, uI: { value: 0.8 } };
{
  const g = new THREE.BufferGeometry(); const b = new Float32Array(PCOUNT * 3), rr = new Float32Array(PCOUNT * 2);
  for (let i = 0; i < PCOUNT; i++){ b[i * 3] = rand(); b[i * 3 + 1] = rand(); b[i * 3 + 2] = rand(); rr[i * 2] = rand(); rr[i * 2 + 1] = rand(); }
  g.setAttribute('position', new THREE.BufferAttribute(b, 3)); g.setAttribute('aRnd', new THREE.BufferAttribute(rr, 2));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: partU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute vec2 aRnd; uniform vec3 uDrift, uBox, uOrigin; uniform float uTime, uPix; varying float vA;
      void main(){ vec3 p = mod(position * uBox + uDrift * (0.55 + aRnd.x) + vec3(sin(uTime * 0.3 + aRnd.y * 30.0) * 2.0, 0.0, cos(uTime * 0.27 + aRnd.x * 20.0) * 2.0), uBox) + uOrigin;
        vec4 mv = viewMatrix * vec4(p, 1.0); float d = -mv.z;
        gl_PointSize = clamp((1.2 + aRnd.y * 2.6) * uPix * 110.0 / max(d, 1.0), 1.0, 22.0);
        vA = smoothstep(900.0, 160.0, d) * smoothstep(1.5, 8.0, d) * (0.55 + 0.45 * sin(uTime * (0.8 + aRnd.x * 1.6) + aRnd.y * 40.0));
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI; varying float vA; void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(uColor, a * a * vA * uI); }`
  }));
  pts.name = 'particles'; pts.frustumCulled = false; pts.renderOrder = 6; scene.add(pts);
}
// warm halos around every lamp and lantern
const haloU = { uI: { value: 0 }, uPix: partU.uPix };
{
  const g = new THREE.BufferGeometry(); const b = new Float32Array(lampPts.length * 3);
  lampPts.forEach((p, i) => b.set(p, i * 3)); g.setAttribute('position', new THREE.BufferAttribute(b, 3));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `uniform float uPix; varying float vD; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_PointSize = clamp(uPix * 1300.0 / max(vD, 1.0), 2.0, 160.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uI; varying float vD; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-r * r * 5.0) * 0.6 + exp(-r * r * 40.0) * 0.6; gl_FragColor = vec4(vec3(1.0, 0.74, 0.42), a * uI * smoothstep(900.0, 120.0, vD)); }`
  }));
  pts.name = 'halos'; pts.frustumCulled = false; pts.renderOrder = 7; scene.add(pts);
}

/* =====================================================================
   13. Fish schools & jellyfish
   ===================================================================== */
/* ---- fish species: clownfish · longfin bannerfish · blue tang · goldfish ---- */
function profAt(pts, u){ if (u <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++){ if (u <= pts[i][0]){ const [u0, a] = pts[i - 1], [u1, b] = pts[i]; const t = (u - u0) / (u1 - u0); return a + (b - a) * t * t * (3 - 2 * t); } } return pts[pts.length - 1][1]; }
function fishBody(H, wk, colorFn, rings = LOW ? 18 : 34, segs = LOW ? 12 : 22){
  const pos = [], col = [], idx = [], c = new THREE.Color(), hEnd = profAt(H, 1);
  const N = rings + 4;
  for (let i = 0; i <= N; i++){
    const u = i <= rings ? i / rings : 1 + (i - rings) / 4 * 0.05;
    const h = u <= 1 ? profAt(H, u) : hEnd * Math.sqrt(Math.max(0, 1 - (u - 1) / 0.05)), w = h * wk * (u > 0.75 ? mix(1, 0.6, (Math.min(u, 1) - 0.75) / 0.25) : 1);
    for (let j = 0; j <= segs; j++){ const a = j / segs * TAU, v = Math.cos(a), sd = Math.sin(a);
      pos.push(0.5 - Math.min(u, 1.05), h * v, w * sd); colorFn(Math.min(u, 1), v, sd, c); col.push(c.r, c.g, c.b); }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < segs; j++){ const a = i * (segs + 1) + j, b = a + segs + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const k = Math.floor(rings * 0.4) * (segs + 1) + Math.floor(segs / 2) * 0 ; // top vertex of a middle ring
  if (g.attributes.normal.getY(k) < 0){ const a = g.index.array; for (let i = 0; i < a.length; i += 3){ const t = a[i]; a[i] = a[i + 1]; a[i + 1] = t; } g.computeVertexNormals(); }
  return g;
}
/** fan-shaped fin: root point → outline, inner colour + crisp rim band */
function fin(root, outline, colIn, colRim, rimT = 0.8, m = null){
  const pos = [], col = [], P = (p, cc) => { pos.push(p[0], p[1], 0); col.push(cc.r, cc.g, cc.b); };
  const ci = (p) => typeof colIn === 'function' ? colIn(p[0], p[1]) : colIn;
  const L = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  for (let k = 0; k < outline.length - 1; k++){
    const p0 = outline[k], p1 = outline[k + 1], q0 = L(root, p0, rimT), q1 = L(root, p1, rimT);
    P(root, ci(root)); P(q0, ci(q0)); P(q1, ci(q1));
    P(q0, colRim); P(p0, colRim); P(p1, colRim); P(q0, colRim); P(p1, colRim); P(q1, colRim);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals(); if (m) g.applyMatrix4(m); return g;
}
const finM = (x, y, z, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z);
function eyes(x, y, w, r, ring){
  const out = [];
  for (const s of [1, -1]){
    out.push(flatTint(new THREE.SphereGeometry(r, 14, 10).translate(x, y, s * (w - r * 0.35)), ring.r, ring.g, ring.b));
    out.push(flatTint(new THREE.SphereGeometry(r * 0.72, 12, 8).translate(x + r * 0.05, y, s * (w - r * 0.35 + r * 0.42)), 0.02, 0.02, 0.03));
    out.push(flatTint(new THREE.SphereGeometry(r * 0.2, 6, 4).translate(x + r * 0.25, y + r * 0.25, s * (w - r * 0.35 + r * 0.95)), 1.6, 1.6, 1.6));
  }
  return out;
}
const C = h => new THREE.Color(h);
const fband = (u, c, hw, edge) => { const d = Math.abs(u - c); return d < hw ? 2 : d < hw + edge ? 1 : 0; };
function clownGeo(){
  const H = [[0, 0.0], [0.04, 0.1], [0.12, 0.19], [0.3, 0.25], [0.55, 0.235], [0.78, 0.16], [0.92, 0.1], [1, 0.095]];
  const OR = C(0xff7514), ORD = C(0xe25300), WH = C(0xfdfbf6), BK = C(0x140a05);
  const body = fishBody(H, 0.44, (u, v, sd, c) => {
    const b1 = fband(u, 0.24 + 0.05 * v * v, 0.045, 0.016), b2 = fband(u, 0.55 - 0.03 * v, 0.055 + 0.015 * v, 0.016), b3 = fband(u, 0.915, 0.032, 0.014);
    const m = Math.max(b1, b2, b3);
    if (m === 2) c.copy(WH); else if (m === 1) c.copy(BK); else c.copy(OR).lerp(ORD, smooth(0.2, 1, v) * 0.5).multiplyScalar(0.92 + 0.12 * smooth(-1, 0, -v));
  });
  const fins = [
    fin([0.12, 0.2], [[0.24, 0.19], [0.2, 0.3], [0.12, 0.34], [0.02, 0.32], [-0.06, 0.23]], OR, BK, 0.78),
    fin([-0.17, 0.19], [[-0.04, 0.22], [-0.08, 0.36], [-0.2, 0.38], [-0.3, 0.3], [-0.34, 0.15]], OR, BK, 0.8),
    fin([-0.18, -0.14], [[-0.07, -0.19], [-0.12, -0.32], [-0.24, -0.33], [-0.33, -0.2], [-0.35, -0.09]], OR, BK, 0.8),
    fin([-0.5, 0], [[-0.47, 0.08], [-0.6, 0.21], [-0.73, 0.18], [-0.79, 0.06], [-0.79, -0.06], [-0.73, -0.18], [-0.6, -0.21], [-0.47, -0.08]], (x) => x > -0.56 ? WH : OR, BK, 0.84),
  ];
  for (const s of [1, -1]){
    fins.push(fin([0.17, -0.02], [[0.2, 0.03], [0.07, 0.07], [-0.02, -0.03], [0.03, -0.12], [0.15, -0.08]], OR, BK, 0.78, finM(0, 0, s * 0.1, s * 0.55)));
    fins.push(fin([0.12, -0.2], [[0.18, -0.21], [0.12, -0.36], [0.03, -0.37], [0.04, -0.22]], OR, BK, 0.75, finM(0, 0, s * 0.03, 0, s * 0.35)));
  }
  return mergeC([body, ...fins, ...eyes(0.39, 0.06, 0.09, 0.034, C(0xff9a3a))]);
}
function bannerGeo(){
  const H = [[0, 0], [0.06, 0.05], [0.14, 0.15], [0.3, 0.38], [0.5, 0.42], [0.72, 0.31], [0.88, 0.13], [1, 0.08]];
  const WH = C(0xf4f6f8), SV = C(0xd8dee4), BK = C(0x15161a), YL = C(0xffd21e), YD = C(0xe8b000);
  const body = fishBody(H, 0.2, (u, v, sd, c) => {
    const k1 = Math.abs(u - (0.3 + 0.03 * v)), k2 = Math.abs(u - (0.64 - 0.13 * v));
    if (k1 < 0.055 || k2 < 0.06) c.copy(BK).lerp(C(0x2a2c33), smooth(0.04, 0.06, Math.min(k1, k2)));
    else if (u < 0.2 && Math.abs(u - 0.15) < 0.03 && v > -0.2) c.copy(BK);
    else if (u > 0.82 && v > -0.1) c.copy(YL).lerp(WH, smooth(0.95, 0.82, u) * 0.5);
    else c.copy(WH).lerp(SV, smooth(-0.2, -1, v) * 0.6 + 0.1 * Math.sin(u * 40));
  });
  const fins = [
    fin([0.18, 0.4], [[0.24, 0.38], [0.14, 0.62], [0.0, 0.88], [-0.22, 1.08], [-0.48, 1.18], [-0.56, 1.16], [-0.32, 0.98], [-0.1, 0.7], [0.0, 0.45], [0.04, 0.4]], WH, C(0xe6eaee), 0.86),
    fin([-0.18, 0.33], [[0.0, 0.42], [-0.12, 0.5], [-0.3, 0.44], [-0.44, 0.24], [-0.43, 0.1]], YL, YD, 0.85),
    fin([-0.15, -0.3], [[0.08, -0.36], [-0.04, -0.56], [-0.24, -0.56], [-0.4, -0.32], [-0.43, -0.12]], (x) => x > -0.12 ? BK : YL, YD, 0.85),
    fin([-0.5, 0], [[-0.48, 0.08], [-0.66, 0.17], [-0.71, 0.0], [-0.66, -0.17], [-0.48, -0.08]], YL, YD, 0.85),
  ];
  for (const s of [1, -1]){
    fins.push(fin([0.12, -0.12], [[0.15, -0.08], [0.0, -0.06], [-0.1, -0.16], [0.08, -0.2]], C(0xf6f2d8), C(0xe8e0b0), 0.8, finM(0, 0, s * 0.07, s * 0.5)));
    fins.push(fin([0.2, -0.36], [[0.24, -0.37], [0.2, -0.56], [0.12, -0.57], [0.14, -0.38]], BK, BK, 0.8, finM(0, 0, s * 0.02, 0, s * 0.3)));
  }
  return mergeC([body, ...fins, ...eyes(0.36, 0.06, 0.035, 0.032, C(0xe8e8e0))]);
}
function tangGeo(){
  const H = [[0, 0], [0.05, 0.12], [0.15, 0.26], [0.4, 0.33], [0.65, 0.3], [0.85, 0.17], [0.95, 0.09], [1, 0.08]];
  const BL = C(0x2552ea), BLL = C(0x4a7bff), NV = C(0x070d34), VI = C(0x7a5cf0), WH = C(0xf8fbff);
  const body = fishBody(H, 0.3, (u, v, sd, c) => {
    const top = 0.33 - 0.18 * Math.sin(Math.PI * clamp((u - 0.15) / 0.75, 0, 1));
    if (u > 0.16 && u < 0.92 && v > top && v < 0.86) c.copy(NV).lerp(BL, smooth(0.86, 0.95, v) * 0.6);
    else if (u > 0.92 && u < 0.97 && Math.abs(v) < 0.18) c.copy(WH);
    else c.copy(BL).lerp(BLL, smooth(-0.1, -0.9, v) * 0.55).multiplyScalar(0.95 + 0.08 * Math.sin(u * 30 + v * 4));
  });
  const fins = [
    fin([-0.05, 0.28], [[0.26, 0.3], [0.15, 0.42], [-0.1, 0.46], [-0.36, 0.38], [-0.46, 0.2], [-0.44, 0.12]], BL, NV, 0.86),
    fin([-0.1, -0.26], [[0.16, -0.28], [0.05, -0.41], [-0.2, -0.43], [-0.4, -0.3], [-0.45, -0.12]], BL, NV, 0.86),
    fin([-0.5, 0], [[-0.48, 0.08], [-0.66, 0.27], [-0.63, 0.07], [-0.61, 0.0], [-0.63, -0.07], [-0.66, -0.27], [-0.48, -0.08]], VI, NV, 0.86),
  ];
  for (const s of [1, -1]) fins.push(fin([0.2, -0.04], [[0.22, 0.01], [0.04, 0.05], [-0.04, -0.06], [0.16, -0.1]], BLL, BL, 0.8, finM(0, 0, s * 0.11, s * 0.5)));
  return mergeC([body, ...fins, ...eyes(0.37, 0.1, 0.1, 0.045, C(0x1a2a6a))]);
}
function goldGeo(){
  const H = [[0, 0], [0.06, 0.12], [0.2, 0.25], [0.45, 0.28], [0.7, 0.2], [0.9, 0.09], [1, 0.07]];
  const RD = C(0xff4a12), OR = C(0xff8a2a), WH = C(0xfff6ee), FIN = C(0xffd0b8);
  const body = fishBody(H, 0.5, (u, v, sd, c) => {
    const n = Math.sin(u * 13 + v * 5) + Math.sin(u * 7 - sd * 4);
    if (n > 1.1 || v < -0.55) c.copy(WH).lerp(OR, 0.15); else c.copy(RD).lerp(OR, smooth(0.6, -0.4, v) * 0.6);
  });
  const fins = [
    fin([-0.08, 0.26], [[0.12, 0.27], [0.0, 0.48], [-0.2, 0.46], [-0.3, 0.2]], RD, FIN, 0.7),
    fin([-0.5, 0.02], [[-0.48, 0.06], [-0.72, 0.38], [-0.95, 0.42], [-0.86, 0.12], [-0.98, -0.02], [-0.86, -0.18], [-0.95, -0.44], [-0.72, -0.4], [-0.48, -0.04]], RD, FIN, 0.55, finM(0, 0, 0.02, 0.25)),
    fin([-0.5, 0.02], [[-0.48, 0.06], [-0.72, 0.38], [-0.95, 0.42], [-0.86, 0.12], [-0.98, -0.02], [-0.86, -0.18], [-0.95, -0.44], [-0.72, -0.4], [-0.48, -0.04]], RD, FIN, 0.55, finM(0, 0, -0.02, -0.25)),
  ];
  for (const s of [1, -1]) fins.push(fin([0.16, -0.08], [[0.2, -0.04], [0.04, 0.0], [-0.04, -0.16], [0.12, -0.18]], OR, FIN, 0.7, finM(0, 0, s * 0.13, s * 0.6)));
  return mergeC([body, ...fins, ...eyes(0.37, 0.07, 0.13, 0.05, C(0xffd04a))]);
}
const SPECIES = { clown: clownGeo(), banner: bannerGeo(), tang: tangGeo(), gold: goldGeo() };
const fishMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.06, side: THREE.DoubleSide }), { fish: true });
const orb = (cx, cy, cz, rx, rz, w, ph = 0, ay = 1) => t => [cx + Math.cos(t * w + ph) * rx, cy + Math.sin(t * w * 1.7 + ph) * ay, cz + Math.sin(t * w + ph) * rz];
const T2 = 14.65;
const SCHOOLS = [
  { sp: 'clown', n: 16, s: 0.95, f: orb(0, 6.5, 84, 13, 9, 0.11, 0, 1.2), sp3: [3, 1.2, 3] },
  { sp: 'clown', n: 10, s: 0.8, f: orb(15, 5, 92, 6, 5, -0.15, 1, 0.8), sp3: [2, 1, 2] },
  { sp: 'clown', n: 12, s: 0.45, f: orb(0, T2 + 4.8, -17, 7.0, 7.0, 0.16, 0, 1.0), sp3: [1.4, 1.1, 1.4] },
  { sp: 'clown', n: 6, s: 0.4, f: orb(0, T2 + 9.5, -17, 8.5, 8.5, -0.12, 2, 0.8), sp3: [1.0, 0.8, 1.0] },
  { sp: 'tang', n: 34, s: 1.3, f: orb(0, 34, -14, 44, 40, 0.05, 0, 5), sp3: [7, 3, 7] },
  { sp: 'banner', n: 18, s: 1.5, f: orb(-102, 24, 2, 28, 26, 0.07, 2, 3), sp3: [5, 2.5, 5] },
  { sp: 'tang', n: 22, s: 1.3, f: orb(104, 26, -12, 26, 24, -0.07, 1, 3), sp3: [5, 2.5, 5] },
  { sp: 'banner', n: 16, s: 1.5, f: orb(0, 30, -90, 40, 14, 0.06, 3, 3), sp3: [5, 2.5, 4] },
  { sp: 'clown', n: 10, s: 0.9, f: t => [66 + Math.sin(t * 0.1) * 16, 13 + Math.sin(t * 0.4) * 0.8, -12 + Math.cos(t * 0.2) * 5], sp3: [2, 1, 2] },
  { sp: 'clown', n: 10, s: 0.8, f: orb(15, 11, 29, 7, 4, 0.14, 0, 0.6), sp3: [2, 0.8, 2] },
  { sp: 'clown', n: 10, s: 0.8, f: orb(-15, 11, 29, 7, 4, -0.14, 1, 0.6), sp3: [2, 0.8, 2] },
  { sp: 'tang', n: 30, s: 1.6, f: orb(-30, 70, 30, 130, 110, 0.025, 0, 8), sp3: [9, 4, 9] },
  { sp: 'banner', n: 12, s: 1.4, f: orb(0, 16, 150, 40, 20, 0.05, 1, 2), sp3: [5, 2, 4] },
  { sp: 'banner', n: 10, s: 1.3, f: orb(-30, 10, 108, 12, 10, 0.08, 1, 1), sp3: [3, 1.5, 3] },
];
const fishBySp = {};
SCHOOLS.forEach((sc, si) => { if (LOW) sc.n = Math.ceil(sc.n * 0.55); for (let i = 0; i < sc.n; i++) (fishBySp[sc.sp] ||= []).push({ si, o: [R(-1, 1) * sc.sp3[0], R(-1, 1) * sc.sp3[1], R(-1, 1) * sc.sp3[2]], lag: R(0, 2.4), ph: R(0, TAU), s: sc.s * R(0.82, 1.18) }); });
const fishMeshes = {};
function addSchool(sc){ if (LOW) sc.n = Math.ceil(sc.n * 0.55); SCHOOLS.push(sc); const si = SCHOOLS.length - 1; for (let i = 0; i < sc.n; i++) (fishBySp[sc.sp] ||= []).push({ si, o: [R(-1, 1) * sc.sp3[0], R(-1, 1) * sc.sp3[1], R(-1, 1) * sc.sp3[2]], lag: R(0, 2.4), ph: R(0, TAU), s: sc.s * R(0.82, 1.18) }); }
function buildFish(){
  for (const [sp, list] of Object.entries(fishBySp)){
    const m = new THREE.InstancedMesh(SPECIES[sp], fishMat, list.length); m.name = 'fish'; m.frustumCulled = false; m.castShadow = false; scene.add(m); fishMeshes[sp] = m;
  }
}
const _fd = new THREE.Vector3(), _fm = new THREE.Matrix4(), _fp = new THREE.Vector3(), _fu = new THREE.Vector3(), _fsd = new THREE.Vector3(), _fY = new THREE.Vector3(0, 1, 0);
function updateFish(t){
  for (const [sp, list] of Object.entries(fishBySp)){
    const mesh = fishMeshes[sp]; if (!mesh) continue;
    list.forEach((f, i) => {
      const sc = SCHOOLS[f.si], tt = t * (reduceMotion ? 0.4 : 1) - f.lag;
      const a = sc.f(tt), b = sc.f(tt + 0.6);
      _fp.set(a[0] + f.o[0] + Math.sin(t * 0.7 + f.ph) * 0.6, a[1] + f.o[1] + Math.sin(t * 0.9 + f.ph) * 0.4, a[2] + f.o[2] + Math.cos(t * 0.6 + f.ph) * 0.6);
      _fd.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (_fd.lengthSq() < 1e-8) _fd.set(1, 0, 0); _fd.normalize(); _fd.y = clamp(_fd.y, -0.5, 0.5); _fd.normalize();
      _fsd.crossVectors(_fd, _fY).normalize(); _fu.crossVectors(_fsd, _fd);
      _fm.makeBasis(_fd, _fu, _fsd).scale(_fsd.set(f.s, f.s, f.s)).setPosition(_fp);
      mesh.setMatrixAt(i, _fm);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }
}
deferred.forEach(f => f());
pendingSchools.forEach(addSchool); buildFish();
const jellyU = { uTime: U.uTime, uI: { value: 1 }, uCur: U.uCurrent };
const JELLY = [[-12, 15, 76, 1.8, 0x9fffd0, 1], [11, 19, 92, 2.2, 0xa8d8ff, 1], [-4, 23, 101, 1.6, 0xd8a8ff, 1], [15, 13, 70, 1.5, 0x9ff8e8, 1], [-17, 20, 95, 2.0, 0xffa8e0, 1], [4, 27, 73, 2.4, 0xb0ffb8, 1], [21, 24, 86, 1.7, 0xc8b0ff, 1], [-22, 14, 82, 1.6, 0x9fe8ff, 1],
  [-96, 34, 150, 4.2, 0xa8e8ff], [-128, 52, 112, 3.4, 0xb8f0ff], [-82, 16, 170, 2.6, 0x9fd8ff], [-150, 26, 150, 2.2, 0xc8b8ff], [150, 62, -66, 4.0, 0xff9fd8], [-170, 72, -118, 4.6, 0xc8a0ff], [118, 88, 150, 3.0, 0x9fe8ff], [40, 96, -170, 3.6, 0xffb0c8]];
const jellies = JELLY.map(([x, y, z, r, c, aur = 0], i) => {
  const grp = new THREE.Group(); grp.position.set(x, y, z);
  const u = { ...jellyU, uColor: { value: new THREE.Color(c) }, uR: { value: r }, uPh: { value: i * 1.7 }, uAur: { value: aur } };
  const prof = []; for (let k = 0; k <= 16; k++){ const t = k / 16, a = t * Math.PI * 0.56; prof.push(new THREE.Vector2(Math.sin(a) * r * (1 + 0.18 * t), Math.cos(a) * r * 0.72)); }
  const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform float uTime, uR, uPh; varying vec3 vN, vV; varying float vY, vD;
      void main(){ vec3 p = position; float rim = 1.0 - clamp(p.y / (uR * 0.72), 0.0, 1.0); float pul = sin(uTime * 1.5 + uPh);
        p.xz *= 1.0 + 0.09 * pul * rim; p.y *= 1.0 - 0.05 * pul;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = rim; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI, uAur, uTime, uPh; varying vec3 vN, vV; varying float vY, vD;
      vec3 aurora(float t){ t = fract(t) * 4.0; vec3 c0 = vec3(0.3, 1.0, 0.7), c1 = vec3(0.35, 0.8, 1.0), c2 = vec3(0.72, 0.5, 1.0), c3 = vec3(1.0, 0.55, 0.85);
        return t < 1.0 ? mix(c0, c1, t) : t < 2.0 ? mix(c1, c2, t - 1.0) : t < 3.0 ? mix(c2, c3, t - 2.0) : mix(c3, c0, t - 3.0); }
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = (0.1 + 0.7 * pow(f, 2.0) + 0.25 * vY) * uI * smoothstep(900.0, 150.0, vD);
        vec3 col = mix(uColor, aurora(vY * 0.7 + f * 0.3 + uTime * 0.07 + uPh * 0.13), uAur);
        gl_FragColor = vec4(col * (0.7 + 0.9 * f) * (1.0 + uAur * 0.35), a * (0.85 + uAur * 0.25)); }`
  }));
  const parts = [];
  for (let k = 0; k < 12; k++){
    const a = k * TAU / 12, rr = r * (k % 2 ? 0.55 : 0.92), L = r * R(2.6, 4.6);
    const g = new THREE.PlaneGeometry(r * 0.07, 1, 1, 22); g.translate(0, -0.5, 0); g.scale(1, L, 1);
    const p = g.attributes.position, ak = new Float32Array(p.count), ap = new Float32Array(p.count).fill(k * 0.9);
    for (let j = 0; j < p.count; j++) ak[j] = clamp(-p.getY(j) / L, 0, 1);
    g.setAttribute('aK', new THREE.BufferAttribute(ak, 1)); g.setAttribute('aP', new THREE.BufferAttribute(ap, 1));
    g.rotateY(a); g.translate(Math.sin(a) * rr, 0.05 * r, Math.cos(a) * rr); parts.push(g);
  }
  const tg = mergeNI(parts);
  const tent = new THREE.Mesh(tg, new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `attribute float aK, aP; uniform float uTime, uR, uPh; uniform vec2 uCur; varying float vK, vD;
      void main(){ vec3 p = position; float k = aK * aK; p.x += (sin(uTime * 1.2 + aK * 4.0 + uPh + aP) * 0.35 - uCur.x * 0.5) * k * uR; p.z += (cos(uTime * 1.0 + aK * 3.0 + aP) * 0.3 - uCur.y * 0.5) * k * uR;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vK = aK; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uI, uAur, uTime, uPh; varying float vK, vD;
      void main(){ vec3 aur = 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.3, 0.62) + vK * 0.8 + uTime * 0.07 + uPh * 0.13));
        gl_FragColor = vec4(mix(uColor, aur, uAur), (1.0 - vK) * 0.55 * uI * smoothstep(900.0, 150.0, vD)); }`
  }));
  grp.add(bell, tent); bell.frustumCulled = tent.frustumCulled = false; bell.renderOrder = tent.renderOrder = 8;
  grp.name = 'jelly'; grp.userData = { x, y, z, ph: i * 1.3 }; scene.add(grp); return grp;
});
function buildTornadoes(){
  const geo = new THREE.CylinderGeometry(1, 0.07, 1, 56, 70, true); geo.translate(0, 0.5, 0);
  const SPOTS = [[-175, -70, 20, 125], [195, -30, 17, 110], [-150, 150, 15, 95], [160, 150, 18, 115], [20, -235, 22, 135]];
  SPOTS.forEach(([x, z, r, h], i) => {
    const u = { uTime: U.uTime, uStorm: { value: 0 }, uSeed: { value: i * 3.7 } };
    const m = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `uniform float uTime, uSeed; varying vec2 vU; varying float vF;
        void main(){ vec3 p = position; float h = p.y;
          p.x += (sin(h * 2.4 + uTime * 0.7 + uSeed) * 0.14 + sin(h * 6.0 - uTime * 1.6) * 0.025) * (0.3 + h);
          p.z += cos(h * 2.0 + uTime * 0.6 + uSeed) * 0.12 * (0.3 + h);
          vU = vec2(atan(position.x, position.z) / 6.2832 + 0.5, h);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vF = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz))); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime, uStorm, uSeed; varying vec2 vU; varying float vF;
        float hs(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ns(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hs(i), hs(i + vec2(1, 0)), f.x), mix(hs(i + vec2(0, 1)), hs(i + vec2(1, 1)), f.x), f.y); }
        void main(){ vec2 q = vec2(vU.x * 16.0 + vU.y * 9.0 - uTime * 2.2 + uSeed, vU.y * 7.0 - uTime * 0.4);
          float n = ns(q) * 0.6 + ns(q * 2.3) * 0.3 + ns(q * 5.1) * 0.1;
          float streak = smoothstep(0.38, 0.9, n);
          float a = (0.16 + 0.55 * streak) * smoothstep(0.05, 0.7, vF) * smoothstep(0.0, 0.06, vU.y) * smoothstep(1.0, 0.8, vU.y) * uStorm;
          gl_FragColor = vec4(mix(vec3(0.36, 0.46, 0.52), vec3(0.86, 0.93, 0.96), streak), a); }` });
    const mesh = new THREE.Mesh(geo, m); mesh.scale.set(r, h, r); mesh.renderOrder = 6; mesh.visible = false; mesh.frustumCulled = false;
    const base = terrainH(clamp(x, -320, 320), clamp(z, -320, 320)) - 2; mesh.position.set(x, base, z); scene.add(mesh);
    // debris spiralling in the funnel
    const N = 420, seed = new Float32Array(N * 3); for (let k = 0; k < N; k++){ seed[k * 3] = R(0, TAU); seed[k * 3 + 1] = Math.pow(rand(), 1.4); seed[k * 3 + 2] = R(0.6, 1.15); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); pg.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    const pm = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false,
      vertexShader: `attribute vec3 seed; uniform float uTime; varying float vA;
        void main(){ float h = seed.y; float a = seed.x + uTime * (2.4 - h * 1.2); float r = (0.07 + 0.93 * h) * seed.z;
          vec3 p = vec3(sin(a) * r, h, cos(a) * r); vec4 mv = modelViewMatrix * vec4(p, 1.0); vA = h; gl_PointSize = 260.0 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uStorm; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.82, 0.9, 0.94), (0.55 - vA * 0.3) * uStorm * smoothstep(0.5, 0.2, d)); }` });
    const pts = new THREE.Points(pg, pm); pts.visible = false; pts.frustumCulled = false; mesh.add(pts);
    tornadoes.push({ mesh, pts, u, x, z, base, ph: i * 1.9 });
  });
}
function updateTornadoes(t){
  for (const tw of tornadoes){ const s = cur.storm; tw.u.uStorm.value = s; tw.mesh.visible = tw.pts.visible = s > 0.02;
    if (s > 0.02) tw.mesh.position.set(tw.x + Math.sin(t * 0.05 + tw.ph) * 26, tw.base, tw.z + Math.cos(t * 0.04 + tw.ph) * 20); }
}
function updateJellies(t){ for (const j of jellies){ const u = j.userData; j.position.set(u.x + Math.sin(t * 0.05 + u.ph) * 9 + U.uCurrent.value.x * 4, u.y + Math.sin(t * 0.22 + u.ph) * 4.5, u.z + Math.cos(t * 0.045 + u.ph) * 7 + U.uCurrent.value.y * 4); j.rotation.z = Math.sin(t * 0.3 + u.ph) * 0.12 + U.uCurrent.value.x * 0.06; } }

/* =====================================================================
   14. Time of day & weather presets (smoothly interpolated)
   ===================================================================== */
const PRESET_SRC = {
  morning: { top: '#8fe0ee', bot: '#05283a', fog: '#2a8fae', fogNear: 150, fogFar: 950, hemiSky: '#c8f4ff', hemiGround: '#24505a', hemiI: 0.8, sunCol: '#fff0d4', sunI: 2.35, sunDir: [0.42, 1, 0.55], caustic: 0.95, causticCol: '#e6fdff', rayCol: '#fff4dc', rayI: 0.2, rainbow: 0.75, lamp: 0.0, env: 0.5, exposure: 0.88, water: '#47d2dc', waterGlow: 0.55, part: '#e0fcff', partI: 0.7, storm: 0, sea: '#c8f6ff', seaI: 1.0, jelly: 0.8, bloom: 0.2, glow: 1.0, sunGlow: '#fff3dc' , river: '#3fb6e8' },
  dusk:    { top: '#ffae86', bot: '#140f2c', fog: '#5a4f8e', fogNear: 140, fogFar: 880, hemiSky: '#ffb890', hemiGround: '#2a2252', hemiI: 0.82, sunCol: '#ffb26b', sunI: 2.6, sunDir: [-0.95, 0.42, 0.3], caustic: 0.62, causticCol: '#ffd6a8', rayCol: '#ffc48a', rayI: 0.19, rainbow: 0.35, lamp: 0.38, env: 0.6, exposure: 0.96, water: '#7aa6d8', waterGlow: 0.35, part: '#ffe0c4', partI: 0.7, storm: 0, sea: '#ffb48c', seaI: 0.95, jelly: 1.0, bloom: 0.36, glow: 1.3, sunGlow: '#ff9a5c' , river: '#4f8fd0' },
  night:   { top: '#25418a', bot: '#030712', fog: '#0d1d40', fogNear: 120, fogFar: 760, hemiSky: '#5a78c0', hemiGround: '#0b1226', hemiI: 0.62, sunCol: '#a9c2ff', sunI: 1.05, sunDir: [-0.35, 1, -0.45], caustic: 0.3, causticCol: '#b8ccff', rayCol: '#a8c0ff', rayI: 0.085, rainbow: 0.0, lamp: 1.0, env: 0.38, exposure: 1.12, water: '#1f4f8c', waterGlow: 0.5, part: '#a8d8ff', partI: 0.9, storm: 0, sea: '#3a5aa8', seaI: 0.6, jelly: 1.6, bloom: 0.5, glow: 2.4, sunGlow: '#b8ccff' , river: '#1f4f96' },
  storm:   { top: '#55636e', bot: '#05090e', fog: '#1e2e3a', fogNear: 90, fogFar: 640, hemiSky: '#8698a6', hemiGround: '#0f171e', hemiI: 0.66, sunCol: '#c4d0dc', sunI: 0.8, sunDir: [0.25, 1, 0.15], caustic: 0.14, causticCol: '#d0dce8', rayCol: '#b6c4d2', rayI: 0.05, rainbow: 0.0, lamp: 0.85, env: 0.38, exposure: 1.05, water: '#2c4c5c', waterGlow: 0.25, part: '#c6d4dc', partI: 0.85, storm: 1, sea: '#364650', seaI: 0.6, jelly: 1.2, bloom: 0.42, glow: 1.8, sunGlow: '#c0ccd8' , river: '#2f5a70' },
};
const PRESETS = {};
for (const [k, v] of Object.entries(PRESET_SRC)){ const o = {}; for (const [kk, vv] of Object.entries(v)){ o[kk] = typeof vv === 'string' ? new THREE.Color(vv) : Array.isArray(vv) ? new THREE.Vector3(...vv).normalize() : vv; } PRESETS[k] = o; }
const clone = p => { const o = {}; for (const [k, v] of Object.entries(p)) o[k] = v.clone ? v.clone() : v; return o; };
let from = clone(PRESETS.morning), to = clone(PRESETS.morning), cur = clone(PRESETS.morning), blendT = 1, current = 'morning';
const BLEND_DUR = 2.8;
function setPreset(name, instant = false){
  if (!PRESETS[name]) return;
  current = name; from = clone(cur); to = clone(PRESETS[name]); blendT = instant ? 1 : 0;
  riverMode = name === 'dusk' ? 1 : 0;   // 黄昏 = 落霞粉河; other hours start from their natural colour
  if (instant) cur = clone(to);
  document.querySelectorAll('#timeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === name));
  envDirty = true;
}
function blendStep(dt){
  if (blendT >= 1) return false;
  blendT = Math.min(1, blendT + dt / BLEND_DUR);
  const k = blendT * blendT * (3 - 2 * blendT);
  for (const key of Object.keys(to)){
    const a = from[key], b = to[key];
    if (a.isColor) cur[key].copy(a).lerp(b, k);
    else if (a.isVector3) cur[key].copy(a).lerp(b, k).normalize();
    else cur[key] = mix(a, b, k);
  }
  return true;
}
/* lightning */
let ltTimer = 3.5, ltT = -1, flash = 0; const ltDir = new THREE.Vector3(0, 1, 0);
function updateLightning(dt){
  if (cur.storm > 0.55 && ltT < 0){ ltTimer -= dt; if (ltTimer <= 0){ ltT = 0; ltTimer = 5.5 + rand() * 7; ltDir.set(R(-0.7, 0.7), 1, R(-0.7, 0.7)).normalize(); } }
  flash = 0;
  if (ltT >= 0){
    ltT += dt;
    const a = Math.exp(-Math.pow((ltT - 0.07) / 0.05, 2)), b = 0.62 * Math.exp(-Math.pow((ltT - 0.27) / 0.065, 2)), c = 0.3 * Math.exp(-Math.pow((ltT - 0.46) / 0.05, 2));
    flash = (a + b + c) * cur.storm * (reduceMotion ? 0.35 : 1);
    if (ltT > 0.75) ltT = -1;
  }
}
const _sd = new THREE.Vector3(), _c1 = new THREE.Color(), FLASH_COL = new THREE.Color(0xe2ecff), FLASH_FOG = new THREE.Color(0x8ea2b6);
let lastShadowDir = new THREE.Vector3(), envDirty = true, envTimer = 0;
const drift = new THREE.Vector3();
function applyEnv(dt){
  const c = cur, f = Math.min(flash, 1.2);
  scene.fog.color.copy(c.fog).lerp(FLASH_FOG, f * 0.14); scene.fog.near = c.fogNear; scene.fog.far = c.fogFar;
  skyU.uTop.value.copy(c.top); skyU.uMid.value.copy(scene.fog.color); skyU.uBot.value.copy(c.bot); skyU.uSunCol.value.copy(c.sunGlow); skyU.uFlash.value = f; skyU.uFlash.value = f;
  hemi.color.copy(c.hemiSky); hemi.groundColor.copy(c.hemiGround); hemi.intensity = c.hemiI + f * 0.55;
  _sd.copy(c.sunDir).lerp(ltDir, clamp(f * 1.3, 0, 0.85)).normalize();
  sun.color.copy(c.sunCol).lerp(FLASH_COL, clamp(f, 0, 1)); sun.intensity = c.sunI + f * 4.2;
  sun.position.copy(sun.target.position).addScaledVector(_sd, 420);
  if (_sd.distanceToSquared(lastShadowDir) > 1e-7){ renderer.shadowMap.needsUpdate = true; lastShadowDir.copy(_sd); }
  U.uSunDir.value.copy(c.sunDir); U.uCaustic.value = c.caustic * (1 - f * 0.5); U.uCausticColor.value.copy(c.causticCol); U.uWaterGlow.value = c.waterGlow;
  rayU.uColor.value.copy(c.rayCol); rayU.uI.value = c.rayI; rayU.uRainbow.value = c.rainbow;
  for (const r of rays){ r.material.uniforms.uColor.value.copy(c.rayCol); r.material.uniforms.uI.value = c.rayI + f * 0.08; r.material.uniforms.uRainbow.value = c.rainbow; }
  mats.glass.emissiveIntensity = 0.02 + c.lamp * 1.55; mats.clock.emissiveIntensity = c.lamp * 0.42; mats.lamp.emissiveIntensity = 0.3 + c.lamp * 3.2;
  for (const l of pLights) l.intensity = c.lamp * 115;
  haloU.uI.value = c.lamp * 0.85;
  for (const m of envMats) m.envMapIntensity = c.env;
  mats.water.color.copy(c.water); riverMat.color.copy(c.river);
  libU.uCol.value.copy(c.top).lerp(c.water, 0.5); libU.uI.value = 0.35 + c.caustic * 0.65;
  renderer.toneMappingExposure = c.exposure;
  partU.uColor.value.copy(c.part); partU.uI.value = c.partI;
  seaU.uSea.value.copy(c.sea); seaU.uFog.value.copy(scene.fog.color); seaU.uStorm.value = c.storm; seaU.uFlash.value = f; seaU.uSeaI.value = c.seaI;
  jellyU.uI.value = c.jelly; for (const j of jellies) j.children.forEach(ch => ch.material.uniforms.uI.value = c.jelly + f * 0.4);
  matGlow.color.setScalar(c.glow);
  bloom.strength = c.bloom + f * 0.12;
  U.uSway.value = 1 + c.storm * 2.4;
  U.uCurrent.value.set(mix(0.5, 2.3, c.storm), mix(0.18, 1.2, c.storm));
  const sp = reduceMotion ? 0.35 : 1;
  drift.x += dt * mix(1.4, 9.0, c.storm) * sp; drift.y += dt * mix(1.1, 0.5, c.storm) * sp; drift.z += dt * mix(0.4, 5.0, c.storm) * sp;
  partU.uDrift.value.copy(drift);
  envTimer -= dt;
  if (envDirty && envTimer <= 0){ updateEnv(); envTimer = 0.33; if (blendT >= 1) envDirty = false; }
}

/* =====================================================================
   15. Post-processing
   ===================================================================== */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 40.0), 1.0); }` }));
const DBG = new URLSearchParams(location.search);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.55, 1.05);
composer.addPass(bloom); if (DBG.has('nobloom')) bloom.enabled = false;
{ const hs = (DBG.get('hide') || '').split(','); scene.traverse(o => { if (o.name && hs.includes(o.name)) o.visible = false; }); }
composer.addPass(new OutputPass());

/* =====================================================================
   16. Controls: orbit (default) · free first-person roam · swing ride · interactions · touch joystick
   ===================================================================== */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
controls.minDistance = 6; controls.maxDistance = 560; controls.maxPolarAngle = Math.PI * 0.49; controls.zoomSpeed = 0.9; controls.rotateSpeed = 0.6; controls.panSpeed = 0.8;
controls.update();
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
let mode = 'orbit', prevMode = 'orbit';
const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
const fp = { x: 0, z: 152, y: 0, ty: 0, yaw: 0, pitch: 0.08, keys: {}, locked: false, bob: 0, joy: { x: 0, y: 0 } };
const FP_SPAWN = { x: 0, z: 152, yaw: 0, pitch: 0.08 };
let tween = null;
const look = { id: null, x: 0, y: 0 };

function groundAt(x, z, y){
  let best = null;
  for (const zn of zones){ if (!zn.test(x, z)) continue; const h = zn.h(x, z); if (Math.abs(h - y) <= 1.15 && (best === null || h > best)) best = h; }
  if (best !== null) return best;
  if (Math.abs(x) > 300 || z < -290 || z > 320) return null;
  for (const p of pads) if (sdf(p, x, z) < -0.1) return null;   // inside a built footprint with no walkable surface
  const th = terrainH(x, z);
  return th - y > 0.95 ? null : th;
}
function blockedAt(x, z, y){
  const d = props.door; if (d && d.t < 0.75 && Math.abs(x) < 2.75 && z > -4.3 && z < -2.6 && y > 13) return true;
  for (const o of obstacles){ if (y + 0.3 > o.y0 && y < o.y1){ const dx = x - o.x, dz = z - o.z; const rr = o.r + 0.32; if (dx * dx + dz * dz < rr * rr) return true; } }
  return false;
}
function tryMove(x, z){ const g = groundAt(x, z, fp.y); if (g === null || blockedAt(x, z, g)) return false; fp.x = x; fp.z = z; fp.ty = g; return true; }
function spawnFP(){ Object.assign(fp, { x: FP_SPAWN.x, z: FP_SPAWN.z, yaw: FP_SPAWN.yaw, pitch: FP_SPAWN.pitch }); fp.y = fp.ty = terrainH(fp.x, fp.z); }
function updateFP(dt){
  const k = fp.keys; let mx = 0, mz = 0;
  if (k.KeyW || k.ArrowUp) mz -= 1; if (k.KeyS || k.ArrowDown) mz += 1; if (k.KeyA || k.ArrowLeft) mx -= 1; if (k.KeyD || k.ArrowRight) mx += 1;
  mx += fp.joy.x; mz += fp.joy.y;
  const mag = Math.hypot(mx, mz);
  if (mag > 0.08){
    const run = k.ShiftLeft || k.ShiftRight || Math.hypot(fp.joy.x, fp.joy.y) > 0.92; const l = Math.max(1, mag); mx /= l; mz /= l;
    const speed = (run ? 13 : 6.5) * dt, s = Math.sin(fp.yaw), c = Math.cos(fp.yaw);
    const dx = (c * mx + s * mz) * speed, dz = (-s * mx + c * mz) * speed;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.35));
    for (let i = 0; i < steps; i++){ const sx = dx / steps, sz = dz / steps; if (!tryMove(fp.x + sx, fp.z + sz)){ if (!tryMove(fp.x + sx, fp.z)) tryMove(fp.x, fp.z + sz); } }
    fp.bob += dt * (run ? 11 : 7.5) * Math.min(1, mag);
  }
  fp.y += (fp.ty - fp.y) * Math.min(1, dt * 10);
  camera.position.set(fp.x, fp.y + 1.7 + Math.sin(fp.bob) * 0.035, fp.z);
  camera.rotation.set(fp.pitch, fp.yaw, 0, 'YXZ');
}
function enterFP(){
  if (mode === 'fp') return;
  if (mode === 'swing') exitSwing(true);
  saved.pos.copy(camera.position); saved.target.copy(controls.target);
  mode = 'fp'; controls.enabled = false; tween = null; spawnFP();
  camera.rotation.order = 'YXZ'; document.body.classList.add('fp'); syncModeUI();
}
function exitFP(){
  if (mode === 'swing'){ exitSwing(true); if (mode !== 'fp'){ syncModeUI(); return; } }
  if (mode !== 'fp') return;
  mode = 'orbit'; if (document.pointerLockElement) document.exitPointerLock();
  camera.position.copy(saved.pos); controls.target.copy(saved.target); controls.enabled = true; controls.update();
  fp.keys = {}; fp.joy.x = fp.joy.y = 0; document.body.classList.remove('fp', 'locked'); syncModeUI();
}
const LIB = { x: 0, z: -17, r: 12.4, y0: 14, y1: 31 }, DOOR_OUT = new THREE.Vector3(0, 19.6, 2.5);
const insideLib = p => Math.hypot(p.x - LIB.x, p.z - LIB.z) < LIB.r && p.y > LIB.y0 && p.y < LIB.y1 && p.z < -3.2;
function flyCam(p1, t1, { dur = 1.6, done = null } = {}){
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const crossing = insideLib(p0) !== insideLib(p1);           // pass through the doorway, never through a wall
  if (crossing) props.door.open = 1;
  tween = { t: 0, dur: crossing ? Math.max(dur, 2.4) : dur, p0, t0, p1: p1.clone(), t1: t1.clone(), via: crossing ? DOOR_OUT.clone() : null, done };
}
function stepTween(dt){
  const w = tween; w.t = Math.min(1, w.t + dt / w.dur); const k = w.t < 0.5 ? 4 * w.t ** 3 : 1 - Math.pow(-2 * w.t + 2, 3) / 2;
  if (w.via){ const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k; camera.position.set(a * w.p0.x + b * w.via.x + c * w.p1.x, a * w.p0.y + b * w.via.y + c * w.p1.y, a * w.p0.z + b * w.via.z + c * w.p1.z); }
  else camera.position.lerpVectors(w.p0, w.p1, k);
  controls.target.lerpVectors(w.t0, w.t1, k);
  if (w.t >= 1){ tween = null; w.done && w.done(); }
}
function resetView(){
  if (mode === 'swing'){ exitSwing(); return; }
  if (mode === 'fp'){ spawnFP(); return; }
  flyCam(HOME.pos, HOME.target, { dur: 1.5, done: () => { if (!insideLib(camera.position)) props.door.open = 0; } });
}
/* ---- swing ride ---- */
const swingLook = { yaw: 0, pitch: -0.05 };
function enterSwing(){
  const s = props.swing; if (!s || mode === 'swing') return;
  prevMode = mode;
  if (mode === 'orbit'){ saved.pos.copy(camera.position); saved.target.copy(controls.target); controls.enabled = false; tween = null; }
  if (document.pointerLockElement) document.exitPointerLock();
  mode = 'swing'; s.ride = true; swingLook.yaw = 0; swingLook.pitch = -0.05;
  camera.rotation.order = 'YXZ'; document.body.classList.add('swing'); document.body.classList.remove('fp'); syncModeUI();
}
function exitSwing(silent = false){
  const s = props.swing; if (!s || mode !== 'swing') return;
  s.ride = false; document.body.classList.remove('swing');
  if (prevMode === 'fp'){ mode = 'fp'; const p = new THREE.Vector3(0, 0, 3.2).applyAxisAngle(_ya, s.ry); fp.x = SWING.x + p.x; fp.z = SWING.z + p.z; fp.y = fp.ty = terrainH(fp.x, fp.z); fp.yaw = s.ry; document.body.classList.add('fp'); }
  else { mode = 'orbit'; camera.position.copy(saved.pos); controls.target.copy(saved.target); controls.enabled = true; controls.update(); }
  if (!silent) syncModeUI();
}
const _sw = new THREE.Vector3(), _swq = new THREE.Quaternion();
function updateSwing(dt, t){
  const s = props.swing; if (!s) return;
  const target = s.ride ? 0.52 : 0.05; s.amp += (target - s.amp) * Math.min(1, dt * (s.ride ? 0.45 : 0.3));
  s.ph += dt * Math.sqrt(9.8 / s.L);
  const ang = s.amp * Math.sin(s.ph); s.pivot.rotation.x = ang;
  if (mode === 'swing'){
    _sw.set(0, -s.L + 1.3, -0.05); _sw.applyAxisAngle(new THREE.Vector3(1, 0, 0), ang); _sw.add(s.pivot.position); s.grp.localToWorld(_sw);
    camera.position.copy(_sw);
    camera.rotation.set(clamp(swingLook.pitch - ang * 0.55, -1.2, 1.2), s.ry + Math.PI + swingLook.yaw, Math.sin(s.ph * 0.5) * 0.01, 'YXZ');
  }
}
/* ---- interactions ---- */
const raycaster = new THREE.Raycaster(); const _ndc = new THREE.Vector2();
function pickHit(nx, ny, maxD = Infinity){
  _ndc.set(nx, ny); raycaster.setFromCamera(_ndc, camera); raycaster.far = maxD;
  const hits = raycaster.intersectObjects(interactives.map(i => i.obj), true);
  for (const h of hits){ let o = h.object; while (o){ const it = interactives.find(i => i.obj === o); if (it) return { it, d: h.distance }; o = o.parent; } }
  return null;
}
function interact(it){
  if (it.kind === 'door'){ const d = props.door; d.open = d.open ? 0 : 1; sfx.thud(); }
  else if (it.kind === 'mermaid') toggleSong();
  else if (it.kind === 'pet') greetPet(it.pet);
  else if (it.kind === 'duck') quack(it.duck);
  else if (it.kind === 'statue') openTalk(STATUE_TALK);
  else if (it.kind === 'book') openBook();
  else if (it.kind === 'swing'){ if (mode === 'swing') exitSwing(); else enterSwing(); }
  else if (it.kind === 'booth') openBooth();
  else if (it.kind === 'river') clickRiver();
  else if (it.kind === 'shell') openShell(it.shell);
  else if (it.kind === 'boatcat') greetBoatCat(it.cat || boatCats[BOAT.k = ((BOAT.k ?? -1) + 1) % boatCats.length]);
}
const pointerNdc = e => [(e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1];
let down = null;
canvas.addEventListener('pointerdown', e => {
  down = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };   // event time, not handling time: a slow frame must not turn a tap into a long-press
  if ((mode === 'fp' || mode === 'swing') && !fp.locked){ look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; canvas.setPointerCapture?.(e.pointerId); }
});
window.addEventListener('pointermove', e => {
  if (mode === 'fp' || mode === 'swing'){
    let dx = 0, dy = 0;
    if (fp.locked && mode === 'fp'){ dx = e.movementX * 0.0022; dy = e.movementY * 0.0022; }
    else if (look.id === e.pointerId){ const k = e.pointerType === 'touch' ? 0.006 : 0.004; dx = (e.clientX - look.x) * k; dy = (e.clientY - look.y) * k; look.x = e.clientX; look.y = e.clientY; }
    if (mode === 'fp'){ fp.yaw -= dx; fp.pitch = clamp(fp.pitch - dy, -1.35, 1.35); }
    else { swingLook.yaw = clamp(swingLook.yaw - dx, -1.6, 1.6); swingLook.pitch = clamp(swingLook.pitch - dy, -1.0, 1.0); }
  } else if (e.pointerType === 'mouse') hoverAt(e);
});
window.addEventListener('pointerup', e => {
  if (look.id === e.pointerId) look.id = null;
  if (!down || down.id !== e.pointerId || e.target !== canvas) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = e.timeStamp - down.t < 1200; down = null;
  if (moved > 7 || !quick) return;
  if (mode === 'fp' && fp.locked){ const h = pickHit(0, 0, 12); if (h) interact(h.it); return; }
  const [nx, ny] = pointerNdc(e), h = pickHit(nx, ny, mode === 'orbit' ? Infinity : 14);
  if (h){ interact(h.it); return; }
  if (mode === 'fp' && !isTouch && canvas.requestPointerLock){ try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) {} }
});
let hoverT = 0;
function hoverAt(e){ const now = performance.now(); if (now - hoverT < 90) return; hoverT = now; const h = pickHit(...pointerNdc(e)); canvas.style.cursor = h ? 'pointer' : ''; setPrompt(h ? h.it.label : '', h ? [e.clientX, e.clientY - 28] : null); }
const promptEl = document.getElementById('prompt');
function setPrompt(text, at){ promptEl.textContent = text; promptEl.style.opacity = text ? 1 : 0; if (at){ promptEl.style.left = at[0] + 'px'; promptEl.style.top = at[1] + 'px'; } else { promptEl.style.left = '50%'; promptEl.style.top = '56%'; } }
let aimT = 0;
function aimPrompt(dt){ aimT -= dt; if (aimT > 0) return; aimT = 0.12; if (mode !== 'fp'){ if (mode === 'swing') setPrompt(''); return; } const h = pickHit(0, 0, 12); setPrompt(h ? h.it.label : '', null); }
document.addEventListener('pointerlockchange', () => { fp.locked = document.pointerLockElement === canvas; document.body.classList.toggle('locked', fp.locked); });
window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) return;
  if (mode === 'swing' && e.code === 'Escape'){ exitSwing(); return; }
  if (mode === 'fp'){
    if (e.code === 'Escape'){ if (!fp.locked) exitFP(); return; }
    if (e.code === 'KeyE'){ const h = pickHit(0, 0, 12); if (h) interact(h.it); }
    fp.keys[e.code] = true; if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  }
});
window.addEventListener('keyup', e => { fp.keys[e.code] = false; });
window.addEventListener('blur', () => { fp.keys = {}; });
/* ---- touch joystick ---- */
const joy = document.getElementById('joy'), knob = document.getElementById('knob'); let joyId = null;
const joyMove = e => { const r = joy.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, R0 = r.width / 2;
  let dx = (e.clientX - cx) / R0, dy = (e.clientY - cy) / R0; const l = Math.hypot(dx, dy); if (l > 1){ dx /= l; dy /= l; }
  fp.joy.x = dx; fp.joy.y = dy; knob.style.transform = `translate(${dx * R0 * 0.55}px, ${dy * R0 * 0.55}px)`; };
joy.addEventListener('pointerdown', e => { joyId = e.pointerId; joy.setPointerCapture(e.pointerId); joyMove(e); e.stopPropagation(); });
joy.addEventListener('pointermove', e => { if (e.pointerId === joyId) joyMove(e); });
const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; fp.joy.x = fp.joy.y = 0; knob.style.transform = ''; };
joy.addEventListener('pointerup', joyEnd); joy.addEventListener('pointercancel', joyEnd);
/* ---- UI wiring ---- */
function syncModeUI(){
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === (mode === 'swing' ? prevMode : mode)));
  document.body.classList.toggle('touch', isTouch);
  const hint = document.getElementById('hint');
  if (mode === 'orbit') hint.innerHTML = isTouch ? '<b>浏览</b> · 单指旋转 · 双指缩放平移 · 点按发光的地方互动' : '<b>浏览</b> · 拖拽旋转 · 滚轮缩放 · 右键平移 · 点击场景里的人与物互动 · 左侧<b>探索指引</b>一键前往';
  else if (mode === 'fp') hint.innerHTML = isTouch ? '<b>漫游</b> · 左下摇杆移动（推到底奔跑）· 拖动屏幕环顾 · 点按物体互动' : '<b>漫游</b> · 点击画面锁定鼠标 · <b>WASD</b> 移动 · <b>Shift</b> 奔跑 · 准星对准物体点击或按 <b>E</b> 互动 · <b>Esc</b> 释放鼠标，再按退出';
  else hint.innerHTML = '<b>秋千</b> · 拖动环顾四周 · 点「离开秋千」或按 <b>Esc</b> 回去';
}
document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => { b.dataset.mode === 'fp' ? enterFP() : exitFP(); }));
document.querySelectorAll('#timeSeg button').forEach(b => b.addEventListener('click', () => setPreset(b.dataset.t)));
document.getElementById('resetBtn').addEventListener('click', resetView);
document.getElementById('swingExit').addEventListener('click', () => exitSwing());
syncModeUI();
/* ---- music: the creator's track, autoplay with a gesture fallback ---- */
const musicBtn = document.getElementById('musicBtn'); let musicOn = true, musicSrc = null;
const musicGain = AC.createGain(); musicGain.gain.value = 0.55; musicGain.connect(AC.destination);
let musicLevel = 0.55;
function setMusicVol(v){ musicLevel = v; musicGain.gain.setTargetAtTime(musicOn ? v : 0, AC.currentTime, 0.25); }
function startMusic(){
  if (AC.state !== 'running') AC.resume().then(syncMusic, () => {});
  if (!bgmBuf || musicSrc) { setMusicVol(musicLevel); return; }
  const src = AC.createBufferSource(); src.buffer = bgmBuf; src.loop = true;
  src.loopStart = bgmBuf.__start || 0; src.loopEnd = bgmLoopEnd || bgmBuf.duration;
  src.connect(musicGain); src.start(0, src.loopStart); musicSrc = src; setMusicVol(musicLevel);
}
function loadBgm(){   // music downloads only after the city is open, so it never competes with the scene
  bgmFetch = fetch('bgm.mp3').then(r => r.arrayBuffer()).catch(() => null);
  bgmFetch.then(b => b && new Promise((ok, bad) => AC.decodeAudioData(b, ok, bad))).then(buf => {
    if (!buf) return;
    const d = buf.getChannelData(0); let a = 0, z = d.length - 1;      // loop only the audible part
    while (a < d.length && Math.abs(d[a]) < 0.002) a++;
    while (z > a && Math.abs(d[z]) < 0.002) z--;
    buf.__start = a / buf.sampleRate; bgmLoopEnd = (z + 1) / buf.sampleRate; bgmBuf = buf;
    if (musicOn && window.__entered && !song.on) startMusic(); syncMusic();
  }).catch(() => {});
}
const syncMusic = () => { const playing = musicOn && !!musicSrc && AC.state === 'running'; musicBtn.classList.toggle('on', playing); musicBtn.classList.toggle('off', !musicOn); musicBtn.title = musicOn ? '音乐：开' : '音乐：关'; };
AC.addEventListener && AC.addEventListener('statechange', syncMusic);
musicBtn.addEventListener('click', () => { musicOn = !musicOn; if (musicOn) startMusic(); else setMusicVol(musicLevel); syncMusic(); });
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, e => { if (!window.__entered || musicBtn.contains(e.target)) return; if (AC.state !== 'running') AC.resume().then(syncMusic, () => {}); if (musicOn && !musicSrc) startMusic(); }, { passive: true }));
document.addEventListener('visibilitychange', () => { if (!window.__entered) return; if (document.hidden) AC.suspend(); else AC.resume().then(syncMusic, () => {}); });
syncMusic();
/* ---- sound effects (Web Audio, synthesized) ---- */
const sfx = (() => {
  const ctx = () => { if (AC.state === 'suspended') AC.resume(); return AC; };
  const noiseBuf = (a, sec) => { const b = a.createBuffer(1, a.sampleRate * sec, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  return {
    ring(){ const a = ctx(); if (!a) return; const t0 = a.currentTime;
      for (let k = 0; k < 2; k++){ const g = a.createGain(); g.gain.value = 0; g.connect(a.destination);
        for (const f of [440, 480]){ const o = a.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t0 + k * 1.1); o.stop(t0 + k * 1.1 + 0.8); }
        for (let i = 0; i < 16; i++){ g.gain.setValueAtTime(i % 2 ? 0.0 : 0.07, t0 + k * 1.1 + i * 0.05); } g.gain.setValueAtTime(0, t0 + k * 1.1 + 0.8); } },
    thud(){ const a = ctx(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.frequency.setValueAtTime(90, a.currentTime); o.frequency.exponentialRampToValueAtTime(40, a.currentTime + 0.6); g.gain.setValueAtTime(0.12, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.9); o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + 1); },
    squeak(){ const a = ctx(); if (!a) return; const t = a.currentTime, o = a.createOscillator(), g = a.createGain(); o.type = 'square'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1500, t + 0.06); o.frequency.exponentialRampToValueAtTime(700, t + 0.2); const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24); o.connect(f); f.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.26); },
    boing(){ const a = ctx(); if (!a) return; const t = a.currentTime, o = a.createOscillator(), g = a.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(330, t); o.frequency.exponentialRampToValueAtTime(820, t + 0.16); o.frequency.exponentialRampToValueAtTime(520, t + 0.32); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.45); },
    chime(){ const a = ctx(); if (!a) return; const t = a.currentTime; [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t + i * 0.07); g.gain.exponentialRampToValueAtTime(0.06, t + i * 0.07 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 1.1); o.connect(g); g.connect(a.destination); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 1.2); }); },
    pages(){ const a = ctx(); if (!a) return; for (let k = 0; k < 4; k++){ const s = a.createBufferSource(); s.buffer = noiseBuf(a, 0.18); const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600 + k * 300; f.Q.value = 0.8; const g = a.createGain(), t = a.currentTime + k * 0.11; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); s.connect(f); f.connect(g); g.connect(a.destination); s.start(t); } },
    splash(){ const a = ctx(); if (!a) return; const s = a.createBufferSource(); s.buffer = noiseBuf(a, 0.8); const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800, a.currentTime); f.frequency.exponentialRampToValueAtTime(300, a.currentTime + 0.7); const g = a.createGain(); g.gain.setValueAtTime(0.09, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.8); s.connect(f); f.connect(g); g.connect(a.destination); s.start(); },
  };
})();
/* ---- the telephone booth conversation ---- */
const DLG = {
  stage: '（听筒里传来温柔空灵的女声，带着一点点遥远的恍惚感）',
  intro: '啊…终于有人打开这扇门了。好久好久，没有访客来到这片深海了。',
  opts: [
    { q: '请问，这里是什么地方？', a: '这是被大海藏起来的中转站。一个用来寄存思念的地方。每一通电话，都是一份沉入海底的念想。' },
    { q: '是谁一直在守着这部电话？', a: '没有看守者。只是时光把它留在了这里。它一直在等一个愿意推门进来的人。' },
    { q: '我可以留下一条留言吗？', a: '当然可以。大海会好好保管你的话语。说出来吧，任何你想要寄出去的心事！', input: true },
  ],
};
/* ---- the Poseidon statue ---- */
const STATUE_TALK = {
  kind: 'statue', title: '海神波塞冬雕像', close: '离开',
  stage: '（银灰色的石像手握三叉戟，长发与披风仿佛还在水流里飘动，静静俯视着整座广场）',
  intro: '海神波塞冬雕像 —— 深海圣城的守护者。传说他每一次举起三叉戟，潮汐便改变一次方向。',
  opts: [
    { q: '读一读底座上的铭文', a: '「凡渡海而来者，皆为此城之客。愿你的船永不迷航，愿你的心永远有岸。」' },
    { q: '在雕像前许一个愿', a: () => pick(['石像的眼睛似乎亮了一瞬。远处的水母齐齐转了个圈——你的愿望，海神收下了。', '一串气泡从三叉戟的尖端升起，慢慢漂向海面。据说气泡破掉的那一刻，愿望就会被听见。', '广场的水声忽然安静下来。等它重新响起时，你觉得心里轻了一点。']) },
    { q: '为什么三叉戟是银色的？', a: '圣城的工匠说，金子会在海水里沉睡，而银会记得月光。所以海神的一切，都是用月光的颜色雕的。' },
  ],
};
/* ---- 《潮汐之书》 the talking book ---- */
const BOOK_TALK = {
  kind: 'book', title: '潮汐之书', close: '合上书', inputKey: 'atlantis-book-names', inputHint: '写下你的名字……',
  inputReply: '「……记下了。你的名字已经落在访客名录上，等下一次潮水回来，我会把它念给整座圣城听。」',
  onInput(){ const bk = props.book.book; bk.repaint(17, GUEST_PAGE()); bk.openTo(9); sfx.pages(); },
  stage: '（书页无风自动，哗啦啦翻到中间，一行银蓝色的字慢慢浮了出来）',
  intro: '「咳咳……是谁把我吵醒了？我是《潮汐之书》，记下了这座圣城一万年的潮起潮落。想听点什么？」',
  opts: [
    { q: '翻到下一页 →', keep: true, a: () => turnPage() },
    { q: '给我讲一个深海秘密', a: () => pick(['「海神的三叉戟其实怕痒。每到月圆，广场上的雕像都会偷偷笑出声——不信你半夜来听听。」', '「图书馆最顶层那排书，是鲸鱼们写的。字太大了，一页只写得下一个字。」', '「电话亭里的听筒，连着一千年前的某个下午。有人一直在那头，等一个回答。」', '「广场水池里那五只泡在泳圈里的小家伙，是圣城的守门猫。它们从不下水——因为它们根本不会游泳。」', '「贝壳前的人鱼公主，其实是一束来自很远很远的光。她本人此刻，也许正在另一片海里读你。」']) },
    { q: '帮我占卜今日海运', a: () => { const luck = pick(['大吉', '中吉', '小吉', '吉', '末吉']), item = pick(['一枚卷边的扇贝', '一片会发光的鳞', '水晶珊瑚的碎屑', '一封没寄出的信', '小丑鱼的第三根胡须']), dir = pick(['有水母的那边', '河流流去的方向', '秋千荡起的方向', '电话亭亮灯的方向']); return `「今日海运：${luck}。幸运物是${item}，幸运方向是${dir}。」`; } },
    { q: '你为什么会说话？', a: '「因为读我的人太多了。被念了一万遍的字，总会长出自己的声音。……你刚才，是不是也偷偷念出声了？」' },
    { q: '我能在你这里写下名字吗？', a: '「写吧，用最轻的笔。我的每一页都留着空白，就是在等你这样的人。」', input: true },
  ],
};
/* ---- 梦幻河流: why the river turns pink at dusk, and the aurora that lost its way ---- */
const RIVER_PINK_TALK = {
  kind: 'river', title: '落霞之河', close: '离开河边',
  stage: '（河水慢慢染上一层晚霞的粉色，水面下有细小的光点在游）',
  intro: '这条河平时是蓝色的。可每到黄昏，它就会变成粉色——圣城的人都说，那是一封写了很多年的情书。',
  opts: [
    { q: '为什么黄昏时河水会变成粉色？', a: '黄昏是海面的光唯一能照到河底的时刻。晚霞沉进水里，被河床上的粉珊瑚接住，整条河就像被谁轻轻地脸红了一下。' },
    { q: '那封「情书」是什么故事？', a: '很久以前，圣城有个守灯的少年，河里住着一条人鱼。他们只能在黄昏见面。人鱼每天把一片晚霞藏进鳞片里，说要攒够了，才告诉他一句话。' },
    { q: '后来呢？他们在一起了吗？', a: '少年慢慢老了，再也提不动灯。最后一个黄昏，人鱼把攒了一辈子的晚霞全部倒进了河里。从那天起，每个黄昏，河水都替她说：「我还在这里等你。」' },
    { q: '在粉色的河边许个愿', a: () => pick(['（一尾小鱼衔走了你的愿望，朝晚霞最浓的地方游去了。）', '（河面亮了一下，像有人在很远的地方，轻轻答应了你。）', '（水里浮起一个小小的粉色气泡，碰到你的指尖才破掉。）']) },
    { q: '让河水变成极光色', a: () => { riverMode = 2; sfx.chime(); return '（你轻轻拨了拨水面——粉色像被风吹散，绿、青、紫的光一层层从河底涌了上来。）'; } },
  ],
};
const RIVER_AUR_TALK = {
  kind: 'river', title: '极光之河', close: '离开河边', inputKey: 'atlantis-aurora', inputHint: '写下你想念的人，或一句想说的话……',
  inputReply: '「……收到了。今晚，海面上会有人看见一道特别亮的极光。」',
  stage: '（绿色、青色、紫色的光带在水里缓缓流动，像有人把极光叠好，放进了河里）',
  intro: '海底没有天空，可这条河里有极光。它是从很远很远的北方来的。',
  opts: [
    { q: '海底为什么会有极光？', a: '深海里住着会发光的小生物——夜光藻、栉水母、萤火鱿。洋流把它们一起推进河道，它们的光被水里的盐晶折成一层一层的颜色，就像把北极的极光搬到了海底。' },
    { q: '这道极光有故事吗？', a: '传说北方冰海的一束极光迷了路，沉到了海底。它太孤单，就顺着洋流来到圣城，和发光的小生物们做了朋友，从此住在这条河里。' },
    { q: '它为什么有时亮、有时暗？', a: '因为它只在有人想念远方的时候亮起来。它会把这份想念送到海面——海面上的人抬头看见极光，就知道有人在想他。' },
    { q: '对着极光说一句想念', a: '说吧，它在听。它会替你把话送到海面上去。', input: true },
    { q: '让河水变回落霞粉', a: () => { riverMode = 1; sfx.chime(); return '（极光慢慢沉回河底，晚霞的粉色又一点一点漫了上来。）'; } },
  ],
};
function clickRiver(){ riverMode = riverMode === 1 ? 2 : 1; sfx.chime(); openTalk(riverMode === 2 ? RIVER_AUR_TALK : RIVER_PINK_TALK); }
function updateRiver(dt){ const k = Math.min(1, dt * 1.1); riverU.uPink.value += ((riverMode === 1 ? 1 : 0) - riverU.uPink.value) * k; riverU.uAur.value += ((riverMode === 2 ? 1 : 0) - riverU.uAur.value) * k; }

/* ---- 《潮汐之书》 the eighteen pages ---- */
function bookNames(){ try { return JSON.parse(localStorage.getItem('atlantis-book-names') || '[]').map(o => o.t.slice(0, 12)); } catch (e) { return []; } }
function GUEST_PAGE(){ const n = bookNames(); return { sub: '访客名录', title: '来过这里的人', list: n.length ? n : ['（还没有人写下名字）'], page: 16 }; }
function BOOK_PAGES(){ return [
  { kind: 'cover' },
  { icon: 'trident', sub: '深海圣城 · 馆藏第一号', title: '潮汐之书', body: '记下亚特兰蒂斯一万年的潮起潮落。\n翻开我的人，请放轻呼吸——每一页都还在听。', page: 'i' },
  { sub: '序', title: '写给翻开我的人', body: '你好，旅人。被念了一万遍的字，会长出自己的声音；被翻了一万次的书，会记得每一双手的温度。\n接下来的每一页，都是这座圣城愿意告诉你的秘密。', page: 1 },
  { icon: 'star', sub: '第一章', title: '沉没的圣城', body: '很久以前，亚特兰蒂斯在一夜之间沉入大海。人们没有离开，只是学会了在水里呼吸、在潮声里睡觉。\n从那以后，圣城的钟声都由洋流敲响。', page: 2 },
  { icon: 'trident', sub: '第二章', title: '海神与三叉戟', body: '广场中央站着海神波塞冬。传说他每举起一次三叉戟，潮汐便换一次方向。\n他的一切都用银雕成——金子会在海水里沉睡，而银会记得月光。', page: 3 },
  { icon: 'river', sub: '第三章', title: '落霞之河', body: '黄昏时，海面的晚霞会顺着光沉进河里。守灯的少年和河里的人鱼，只在这一刻相见。\n后来少年老去，人鱼把一生攒下的晚霞倒进河中——从此每个黄昏，河水都是粉色的。', page: 4 },
  { icon: 'star', sub: '第四章', title: '极光之河', body: '北方冰海的一束极光迷了路，沉到海底。它太孤单，便住进圣城的河里，和夜光藻、栉水母做了朋友。\n只要有人真心想念远方，河水就会亮成极光的颜色。', page: 5 },
  { icon: 'cat', sub: '第五章', title: '五只守门猫', body: '广场两侧的水池里，嘤嘤子、咪奈花、浪浪仙、球棒狸和晴天鸟鸟坐在游泳圈里打盹。\n它们是圣城的守门猫，从不下水——因为它们根本不会游泳。', page: 6 },
  { icon: 'shell', sub: '第六章', title: '会开口的贝壳', body: '广场、楼梯口和长廊上，各睡着一枚贝壳。轻轻敲一敲，它会张开嘴，把人鱼守书人的一段记忆交给你。\n记忆可以带走，贝壳会再长出新的。', page: 7 },
  { icon: 'boat', sub: '第七章', title: '猫糕号', body: '右边那条河的上游，停着一艘小小的猫糕号。船上住着萤绒绒、墨镜猫咪和谐乐小喵。\n它们每天唯一的工作，是向路过的人说「你好」。', page: 8 },
  { icon: 'phone', sub: '第八章', title: '海底电话亭', body: '电话亭的听筒，连着一千年前的某个下午。有人一直在那头，等一个回答。\n如果你拿起它，请先说：「我在。」', page: 9 },
  { icon: 'swing', sub: '第九章', title: '水晶秋千', body: '水晶珊瑚下挂着一架秋千，秋千下是一小汪极光色的水。\n荡得越高，越能看见远处那条河——据说两个人一起荡，会看见同一种颜色。', page: 10 },
  { icon: 'mermaid', sub: '第十章', title: '人鱼守书人', body: '图书馆里的人鱼，是一束来自很远很远的光。她把自己投影在这里，替所有不在的人守着书。\n点她一下，她会为你唱歌。', page: 11 },
  { sub: '附录一', title: '潮汐历', body: '清晨 · 潮水清亮，适合读诗。\n黄昏 · 河水变粉，适合想念。\n夜晚 · 水母点灯，适合许愿。\n暴风雷雨 · 鲸鱼唱歌，适合躲进图书馆。', page: 12 },
  { icon: 'coral', sub: '附录二', title: '深海图鉴', body: '水晶珊瑚：月圆时会轻轻发光。\n管珊瑚：一根一根，像海底的风琴。\n海葵：小丑鱼的家，也是它的被子。\n金鱼：只住在电话亭附近，因为它们喜欢听人说话。', page: 13 },
  { icon: 'star', sub: '附录三', title: '深海星图', body: '海底看不见星星，所以圣城的人把星星画进了书里。\n这一页上的每一个光点，都是一位曾经来过这里的旅人。', page: 14 },
  { sub: '后记', title: '没有写完的一页', body: '这本书永远写不完。每一个推开图书馆大门的人，都会悄悄添上一行。\n下一页，留给你。', page: 15 },
  GUEST_PAGE(),
  { sub: '请用最轻的笔', title: '写下你的名字', lines: 8, page: 17 },
]; }
const PAGE_TEXT = BOOK_PAGES();
function turnPage(){
  const bk = props.book.book; bk.next(); sfx.pages();
  const s = bk.spread, r = PAGE_TEXT[Math.min(2 * s, PAGE_TEXT.length - 1)];
  return r.body ? `「${r.sub ? r.sub + ' · ' : ''}${r.title}」\n${r.body.split('\n')[0]}` : `（书页翻到了「${r.title}」那一页。）`;
}
const HOLO_LINES = ['你好呀，旅人。我是这座图书馆的人鱼守书人——不过你看到的，只是我的一道投影哦。', '嘘……贝壳里还睡着一千个故事。你想先听哪一个？', '信号有点不稳呢……没关系，只要你还在看，我就一直在这里。', '欢迎来到深海圣城～别忘了去广场看看那五只泡在泳圈里的萌宠！'];

const dlg = document.getElementById('dlg'), dlgLog = document.getElementById('dlgLog'), dlgOpts = document.getElementById('dlgOpts'), dlgIn = document.getElementById('dlgInput'), msgEl = document.getElementById('msg'), dlgTtl = document.getElementById('dlgTtl'), hangBtn = document.getElementById('hang');
let typing = null, dlgOpen = false, talk = null, talkTimer = null;
function typeLine(cls, text, done){
  const p = document.createElement('p'); p.className = cls; dlgLog.appendChild(p); let i = 0;
  if (typing) clearInterval(typing);
  typing = setInterval(() => { p.textContent = text.slice(0, ++i); dlgLog.scrollTop = dlgLog.scrollHeight; if (i >= text.length){ clearInterval(typing); typing = null; done && done(); } }, 40);
}
function sayLine(cls, text){ const p = document.createElement('p'); p.className = cls; p.textContent = text; dlgLog.appendChild(p); dlgLog.scrollTop = dlgLog.scrollHeight; }
function showOpts(){ if (!talk) return; dlgOpts.innerHTML = ''; talk.opts.forEach((o, i) => { const b = document.createElement('button'); b.textContent = o.q; if (o.asked) b.classList.add('asked'); b.onclick = () => askOpt(i); dlgOpts.appendChild(b); }); dlgOpts.style.display = 'flex'; }
function askOpt(i){
  if (typing || !talk) return; const cfg = talk, o = cfg.opts[i]; o.asked = true; dlgOpts.style.display = 'none'; dlgIn.style.display = 'none';
  sayLine('me', '你：' + o.q);
  const ans = typeof o.a === 'function' ? o.a() : o.a; if (o.keep) o.asked = false;
  setTimeout(() => { if (talk !== cfg) return; typeLine('voice', /^[「（]/.test(ans) ? ans : '「' + ans + '」', () => { if (o.input){ dlgIn.style.display = 'flex'; msgEl.placeholder = cfg.inputHint || '写下你想寄出去的心事……'; msgEl.focus({ preventScroll: true }); } showOpts(); }); }, 450);
}
document.getElementById('send').addEventListener('click', () => {
  const t = msgEl.value.trim(); if (!t || typing || !talk) return; const cfg = talk;
  try { const k = cfg.inputKey || 'atlantis-letters', a = JSON.parse(localStorage.getItem(k) || '[]'); a.push({ t, at: Date.now() }); localStorage.setItem(k, JSON.stringify(a)); } catch (e) {}
  msgEl.value = ''; dlgIn.style.display = 'none'; dlgOpts.style.display = 'none'; sayLine('me', '你：' + t); cfg.onInput && cfg.onInput(t);
  setTimeout(() => { if (talk === cfg) typeLine('voice', cfg.inputReply || '「……我听见了。它已经沉进海底最安静的地方，会被好好地保管。」', showOpts); }, 500);
});
function openTalk(cfg, delay = 0){
  if (talk) closeTalk();
  talk = cfg; dlgOpen = true; cfg.opts.forEach(o => o.asked = false);
  dlgTtl.textContent = cfg.title; hangBtn.textContent = cfg.close || '关闭'; dlg.dataset.kind = cfg.kind;
  dlgLog.innerHTML = ''; dlgOpts.style.display = 'none'; dlgIn.style.display = 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  clearTimeout(talkTimer);
  talkTimer = setTimeout(() => { if (talk !== cfg) return; dlg.classList.add('show'); if (cfg.stage) sayLine('stage', cfg.stage); setTimeout(() => { if (talk === cfg) typeLine('voice', cfg.intro, showOpts); }, cfg.stage ? 600 : 150); }, delay);
}
function closeTalk(){ const cfg = talk; dlg.classList.remove('show'); dlgOpen = false; talk = null; clearTimeout(talkTimer); if (typing){ clearInterval(typing); typing = null; } cfg && cfg.onClose && cfg.onClose(); }
function openBooth(){
  const b = props.booth; if (!b || (talk && talk.kind === 'booth')) return;
  b.open = 1; b.ring = 2.4; sfx.ring(); setMusicVol(0.2);
  openTalk({ ...DLG, kind: 'booth', title: '神秘海底电话亭', close: '挂断', onClose(){ setMusicVol(0.55); b.open = 0; b.ring = 0; } }, 2300);
}
function openBook(){
  const pb = props.book; if (!pb) return; const bk = pb.book;
  if (talk && talk.kind === 'book'){ turnPage(); return; }            // tapping the open book turns the page
  pb.active = 1; bk.active = 1; bk.openTo(1); sfx.pages();
  openTalk({ ...BOOK_TALK, onClose(){ pb.active = 0; bk.active = 0; bk.close(); setTimeout(() => sfx.pages(), 250); } }, 900);
}
hangBtn.addEventListener('click', closeTalk);

/* ---- the mermaid's song 《美人鱼沃雅尼莎》 ---- */
const song = { el: null, src: null, gain: null, an: null, data: null, on: false, level: 0 };
function ensureSong(){
  if (song.el) return;
  const el = new Audio('song-voyanisa.mp3'); el.preload = 'auto'; el.crossOrigin = 'anonymous';
  song.el = el; song.src = AC.createMediaElementSource(el); song.gain = AC.createGain(); song.gain.gain.value = 0.95;
  song.an = AC.createAnalyser(); song.an.fftSize = 256; song.data = new Uint8Array(song.an.frequencyBinCount);
  song.src.connect(song.gain); song.gain.connect(AC.destination); song.src.connect(song.an);
  el.addEventListener('ended', () => stopSong(true));
}
function startSong(){
  ensureSong(); if (AC.state !== 'running') AC.resume();
  if (talk) closeTalk();
  const h = props.holo; h.glitch = 0.6; song.on = true; song.el.currentTime = 0;
  song.el.play().catch(() => { song.on = false; });
  setMusicVol(0.06);
  sayBubble(h.pivot, h.side, pick(HOLO_LINES), 3.6, true, true);
  setTimeout(() => { if (song.on) sayBubble(h.pivot, h.side, '♪ 正在为你歌唱《美人鱼》<br><small>再点一下她可以停下</small>', 9999, true, true); }, 3700);
}
function stopSong(ended = false){
  if (!song.on) return; song.on = false;
  if (!ended) song.el.pause();
  setMusicVol(0.55);
  const h = props.holo; sayBubble(h.pivot, h.side, ended ? '谢谢你听我唱完这首歌～' : '下次再唱给你听吧～', 3, true);
}
function toggleSong(){ song.on ? stopSong() : startSong(); }
function songLevel(){ if (!song.on || !song.an) return 0; song.an.getByteFrequencyData(song.data); let s = 0; for (let i = 2; i < 40; i++) s += song.data[i]; return s / (38 * 255); }

/* ---- speech bubbles that follow a 3D anchor ---- */
const bubbleLayer = document.getElementById('bubbles'), bubbleList = [], _bp = new THREE.Vector3();
function sayBubble(obj, offset, html, dur = 2.8, wrap = false, side = false){
  for (const b of bubbleList.filter(b => b.obj === obj)){ b.el.remove(); bubbleList.splice(bubbleList.indexOf(b), 1); }
  const el = document.createElement('div'); el.className = 'bubble' + (wrap ? ' wrap' : '') + (side ? ' side' : ''); el.innerHTML = html; if (wrap) el.style.maxWidth = '260px'; bubbleLayer.appendChild(el);
  bubbleList.push({ obj, offset: offset.clone(), el, t: 0, dur, side });
  requestAnimationFrame(() => el.classList.add('show'));
}
function updateBubbles(dt){
  for (let i = bubbleList.length - 1; i >= 0; i--){
    const b = bubbleList[i]; b.t += dt;
    if (b.t > b.dur){ b.el.classList.remove('show'); if (b.t > b.dur + 0.3){ b.el.remove(); bubbleList.splice(i, 1); } continue; }
    b.obj.localToWorld(_bp.copy(b.offset)); _bp.project(camera);
    const vis = _bp.z < 1 && Math.abs(_bp.x) < 1.25 && _bp.y > -1.1 && _bp.y < 1.6;
    b.el.style.visibility = vis && (!b.side || insideLib(camera.position)) ? 'visible' : 'hidden';
    const bob = Math.sin(Math.min(1, b.t * 4) * Math.PI) * 6;
    if (b.side){   // to the right of the anchor, vertically centred on it: the face and neck stay clear
      const x = Math.min((_bp.x * 0.5 + 0.5) * window.innerWidth + 18, window.innerWidth - b.el.offsetWidth - 70), y = clamp((-_bp.y * 0.5 + 0.5) * window.innerHeight - bob, 90 + b.el.offsetHeight / 2, window.innerHeight - 130);
      b.el.style.transform = `translate(${x}px, ${y}px) translate(0, -50%)`;
    } else {
      const x = clamp((_bp.x * 0.5 + 0.5) * window.innerWidth, 150, window.innerWidth - 150), y = Math.max(b.el.offsetHeight + 90, (-_bp.y * 0.5 + 0.5) * window.innerHeight - 10 - bob);
      b.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }
}

/* ---- book animation ---- */
function updateBook(dt, t){
  const pb = props.book; if (!pb) return;
  pb.a += (pb.active - pb.a) * Math.min(1, dt * 2.5); pb.book.update(dt, t);
  pb.spark.material.opacity = 0.1 + pb.a * 0.8;
  const a = pb.spark.geometry.attributes.position.array; for (let i = 0; i < a.length; i += 3){ a[i + 1] += dt * (0.15 + pb.a * 0.6); if (a[i + 1] > 1.8) a[i + 1] = 0.15; } pb.spark.geometry.attributes.position.needsUpdate = true;
}

/* ---- guide panel: fly to every interactive spot ---- */
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const SPOTS = {
  booth:  () => [V3(BOOTH.x + 9, BOOTH.top + 7, BOOTH.z + 17), V3(BOOTH.x, BOOTH.top + 4.5, BOOTH.z)],
  garden: () => { const a = Math.atan2(BOOTH.x - SWING.x, BOOTH.z - SWING.z), fx = Math.sin(a), fz = Math.cos(a); return [V3(SWING.x + fx * 15, SWING.top + 5.6, SWING.z + fz * 15), V3(SWING.x, SWING.top + 3.4, SWING.z)]; },
  library:() => [V3(0, 19.6, -5.4), V3(0, 18.4, -17)],
  book:   () => [V3(-4.9, 17.75, -11.4), V3(-6.6, 16.15, -13.8)],
  holo:   () => [V3(0.8, 18.9, -6.0), V3(0, 18.5, -14.6)],
  pets:   () => [V3(-5, 18, 118), V3(-5, 2.4, 84)],
  statue: () => [V3(6, 10, 99), V3(0, 8.6, 84)],
  river:  () => [V3(71, 30, 80), V3(73, -6, 10)],
  boat:   () => { const p = BOAT.root.position, f = V3(Math.sin(BOAT.ry), 0, Math.cos(BOAT.ry)); return [V3(p.x + f.x * 12.5, p.y + 5.5, p.z + f.z * 12.5), V3(p.x, p.y + 2.2, p.z)]; },
  shell:  i => { const sh = shellList[i], f = V3(Math.sin(sh.ry), 0, Math.cos(sh.ry)); return [V3(sh.pos.x + f.x * 4.6, sh.pos.y + 2.7, sh.pos.z + f.z * 4.6), V3(sh.pos.x, sh.pos.y + 0.95, sh.pos.z)]; },
};
function flyTo(key, after){
  if (mode === 'swing') exitSwing(); if (mode === 'fp') exitFP();
  if (talk) closeTalk();
  let p1, t1;
  if (/^shell\d$/.test(key)) [p1, t1] = SPOTS.shell(+key.slice(5));
  else if (/^pet\d$/.test(key)){ const pt = petList[+key.slice(3)]; const h = pt.g.position; const side = Math.sign(h.x) || 1; t1 = V3(h.x, h.y + 1.2, h.z); p1 = V3(h.x - side * 3.2, h.y + 4.2, h.z + 7.2); }
  else [p1, t1] = SPOTS[key]();
  const toLib = insideLib(p1);
  flyCam(p1, t1, { dur: 1.7, done: () => { if (!toLib) props.door.open = 0; libT = 0; after && after(); } });
  document.querySelectorAll('#guideList > button').forEach(b => b.classList.toggle('here', b.dataset.go === key));
}
const guide = document.getElementById('guide'), guideToggle = document.getElementById('guideToggle');
guideToggle.addEventListener('click', () => { const o = !guide.classList.contains('open'); guide.classList.toggle('open', o); guideToggle.setAttribute('aria-expanded', o); });
const riverHint = new THREE.Object3D(); riverHint.position.set(riverX(30), riverY(30) + 2, 30); scene.add(riverHint);
const GUIDE_AFTER = {
  river: () => { if (riverMode) { sfx.chime(); openTalk(riverMode === 2 ? RIVER_AUR_TALK : RIVER_PINK_TALK); } else sayBubble(riverHint, V3(0, 0, 0), '河水平时是蓝色的～<small>点一点河面，它会变成落霞粉或极光色</small>', 4.5, true); },
  shell0: () => openShell(shellList[0]),
  boat: () => greetBoatCat(boatCats[0]),
};
document.querySelectorAll('#guideList > button').forEach(b => b.addEventListener('click', () => flyTo(b.dataset.go, GUIDE_AFTER[b.dataset.go])));
const chipRow = (id, items) => { const el = document.getElementById(id); for (const [label, go] of items){ const c = document.createElement('button'); c.textContent = label; c.addEventListener('click', go); el.appendChild(c); } };
chipRow('riverChips', [['落霞粉', () => flyTo('river', () => { riverMode = 1; sfx.chime(); openTalk(RIVER_PINK_TALK); })], ['极光', () => flyTo('river', () => { riverMode = 2; sfx.chime(); openTalk(RIVER_AUR_TALK); })]]);
chipRow('shellChips', shellList.map((sh, i) => [sh.name.replace('贝壳', ''), () => flyTo('shell' + i, () => openShell(sh))]));
chipRow('boatChips', boatCats.map(c => [c.name, () => flyTo('boat', () => greetBoatCat(c))]));
{ const chips = document.getElementById('petChips'); PETS.forEach((d, i) => { const c = document.createElement('button'); c.textContent = d.name; c.addEventListener('click', () => flyTo('pet' + i, () => greetPet(petList[i]))); chips.appendChild(c); }); }
if (!window.matchMedia('(max-width: 760px)').matches) guide.classList.add('open'), guideToggle.setAttribute('aria-expanded', true);


/* ---- 秘密贝壳: the memory card (gyroscope / mouse tilt, tap to save) ---- */
const shellCard = document.getElementById('shellCard'), scTilt = document.getElementById('scTilt'), scImg = document.getElementById('scImg'), scToast = document.getElementById('scToast');
const tilt = { x: 0, y: 0, tx: 0, ty: 0, last: -9, base: null };
let cardShell = null, toastT = 0;
function openShell(sh){
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {});   // iOS asks inside the tap
  if (talk) closeTalk();
  if (document.pointerLockElement) document.exitPointerLock();
  sh.open = 1; sfx.chime(); clearTimeout(sh.timer);
  sh.timer = setTimeout(() => showCard(sh), 800);
}
function showCard(sh){
  cardShell = sh; scImg.src = sh.img; scImg.alt = sh.title;
  document.getElementById('scTtl').textContent = sh.title; document.getElementById('scSub').textContent = sh.sub;
  tilt.base = null; tilt.last = -9; shellCard.classList.remove('show'); void shellCard.offsetWidth; shellCard.classList.add('show'); shellCard.setAttribute('aria-hidden', 'false');
}
function hideCard(){
  if (!cardShell) return; const sh = cardShell; cardShell = null;
  shellCard.classList.remove('show'); shellCard.setAttribute('aria-hidden', 'true');
  clearTimeout(sh.timer); sh.timer = setTimeout(() => { sh.open = 0; }, 350);
}
function toast(msg){ scToast.textContent = msg; scToast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => scToast.classList.remove('show'), 2600); }
async function saveCard(){
  const sh = cardShell; if (!sh) return; const name = `深海圣城·${sh.title}.jpg`;
  try {
    const blob = await (await fetch(sh.img)).blob(), file = new File([blob], name, { type: 'image/jpeg' });
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })){ await navigator.share({ files: [file], title: sh.title }); toast('在分享面板里选「存储图像」，就会保存到相册'); return; }
    const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
    toast(isTouch ? '已开始保存；若没反应，长按图片选「保存图片」' : '图片已保存到下载文件夹');
  } catch (e) { if (e && e.name === 'AbortError') return; toast('长按图片，选择「保存图片」即可存进相册'); }
}
scTilt.addEventListener('click', e => { e.stopPropagation(); saveCard(); });
document.getElementById('scSave').addEventListener('click', e => { e.stopPropagation(); saveCard(); });
document.getElementById('scClose').addEventListener('click', e => { e.stopPropagation(); hideCard(); });
shellCard.addEventListener('click', e => { if (e.target === shellCard) hideCard(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && cardShell) hideCard(); });
window.addEventListener('pointermove', e => { if (!cardShell || e.pointerType === 'touch') return; tilt.tx = (0.5 - e.clientY / window.innerHeight) * 26; tilt.ty = (e.clientX / window.innerWidth - 0.5) * 32; tilt.last = performance.now() / 1000; });
scTilt.addEventListener('touchmove', e => { if (!cardShell) return; const t = e.touches[0], r = scTilt.getBoundingClientRect(); tilt.tx = clamp((0.5 - (t.clientY - r.top) / r.height) * 30, -22, 22); tilt.ty = clamp(((t.clientX - r.left) / r.width - 0.5) * 36, -26, 26); tilt.last = performance.now() / 1000; }, { passive: true });
window.addEventListener('deviceorientation', e => {
  if (!cardShell || e.beta == null) return;
  if (!tilt.base) tilt.base = { b: e.beta, g: e.gamma };
  tilt.tx = clamp(-(e.beta - tilt.base.b) * 0.9, -22, 22); tilt.ty = clamp((e.gamma - tilt.base.g) * 1.0, -26, 26); tilt.last = performance.now() / 1000;
});
function updateShellCard(dt){
  if (!cardShell) return;
  const now = performance.now() / 1000;
  if (now - tilt.last > 2.2){ tilt.tx = Math.sin(now * 0.9) * 9; tilt.ty = Math.sin(now * 0.7 + 1) * 13; }   // idle sway so the foil keeps catching light
  const k = Math.min(1, dt * 7); tilt.x += (tilt.tx - tilt.x) * k; tilt.y += (tilt.ty - tilt.y) * k;
  scTilt.style.transform = `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg)`;
  scTilt.style.setProperty('--gx', (50 + tilt.y * 1.8).toFixed(1) + '%'); scTilt.style.setProperty('--gy', (50 - tilt.x * 2.2).toFixed(1) + '%');
  scTilt.style.setProperty('--fx', (50 + tilt.y * 2.6 - tilt.x * 1.2).toFixed(1) + '%');
}

/* ---- library: way back out to the hall ---- */
const libExit = document.getElementById('libExit');
libExit.addEventListener('click', () => {
  if (mode === 'fp'){ Object.assign(fp, { x: 0, z: 1.4, yaw: 0, pitch: 0.05 }); fp.y = fp.ty = 14.65; props.door.open = 0; return; }
  if (mode === 'swing') exitSwing();
  flyCam(V3(0, 21, 13.5), V3(0, 18.6, -3.5), { dur: 2.2, done: () => { props.door.open = 0; } });
});
let libT = 0;
function updateLibExit(dt){ libT -= dt; if (libT > 0) return; libT = 0.15; const inside = insideLib(mode === 'orbit' ? camera.position : V3(fp.x, fp.y + 1.7, fp.z)) && !(tween && tween.via); libExit.classList.toggle('show', inside && mode !== 'swing'); }
/* ---- prop animation ---- */
function updateProps(dt, t){
  const d = props.door;
  if (d){ d.t += (d.open - d.t) * Math.min(1, dt * 1.6); const e = d.t * d.t * (3 - 2 * d.t); for (const l of d.leaves) l.pivot.rotation.y = (l.sd < 0 ? 1 : -1) * e * 1.62; }
  updateHolo(dt, t);
  const b = props.booth;
  if (b){ b.t += (b.open - b.t) * Math.min(1, dt * 2.2); b.doorPivot.rotation.y = -1.75 * b.t * b.t * (3 - 2 * b.t);
    b.lit += ((b.open ? 1 : 0) - b.lit) * Math.min(1, dt * 1.5);
    b.light.intensity = 6 + b.lit * 26; b.glass.emissiveIntensity = 0.9 + b.lit * 0.9; b.bulb.material.emissiveIntensity = 1.2 + b.lit * 2.5;
    if (b.ring > 0){ b.ring -= dt; const a = (b.ring % 1.1) < 0.8 ? 1 : 0; b.phone.position.x = Math.sin(t * 90) * 0.012 * a; b.phone.rotation.z = Math.sin(t * 70) * 0.04 * a; b.phone.children[b.phone.children.length - 2].position.y = 0.33 + Math.abs(Math.sin(t * 60)) * 0.02 * a; }
    else { b.phone.position.x = 0; b.phone.rotation.z = 0; } }
  const bb = props.bubbles;
  if (bb){ const a = bb.bg.attributes.position.array; bb.seed.forEach(([ox, oz, sp, ph], k) => { const h = (t * sp + ph) % 9; a[k * 3] = bb.x + ox + Math.sin(t * 2 + k) * 0.12; a[k * 3 + 1] = bb.y + 0.5 + h * 1.4; a[k * 3 + 2] = bb.z + oz; }); bb.bg.attributes.position.needsUpdate = true; }
  for (const p of props.pages || []){ p.m.position.set(p.base.x + Math.sin(t * 0.4 + p.ph) * 0.3, p.base.y + Math.sin(t * 0.7 + p.ph) * 0.35, p.base.z + Math.cos(t * 0.35 + p.ph) * 0.3); p.m.rotation.set(Math.sin(t * 0.5 + p.ph) * 0.6, t * 0.3 + p.ph, Math.cos(t * 0.6 + p.ph) * 0.4); }
}
function clampOrbit(){
  const t = controls.target; t.x = clamp(t.x, -230, 230); t.z = clamp(t.z, -210, 230); t.y = clamp(t.y, -20, 90);
  const p = camera.position;
  if (p.y > SEA_Y - 30) p.y = SEA_Y - 30;
  const g = terrainH(clamp(p.x, -230, 230), clamp(p.z, -230, 240));
  if (p.y < g + 2) p.y = g + 2;
}

/* =====================================================================
   17. Resize, loop, viewer contract
   ===================================================================== */
function onResize(){
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h); composer.setSize(w, h); partU.uPix.value = renderer.getPixelRatio() * (h / 900);
}
window.addEventListener('resize', onResize); onResize();

const clock = new THREE.Clock(); let time = 0, frames = 0;
function frame(){
  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt * (reduceMotion ? 0.45 : 1); U.uTime.value = time;
  if (blendStep(dt)) envDirty = true;
  updateLightning(dt); applyEnv(dt);
  updateRays(time); updateFish(time); updateJellies(time); updateTornadoes(time);
  updateSwing(dt, time); updateProps(dt, time); updatePets(dt, time); updateDucks(dt, time); updateBook(dt, time); updateShells(dt, time); updateBoat(dt, time); updateRiver(dt); updateShellCard(dt); aimPrompt(dt);
  if (mode === 'orbit'){
    if (tween) stepTween(dt);
    controls.update(); clampOrbit();
  } else if (mode === 'fp') updateFP(dt);
  sky.position.copy(camera.position);
  composer.render();
  updateBubbles(dt); updateLibExit(dt);
  if (++frames === 3) window.__sceneReady = true;
  requestAnimationFrame(frame);
}
function fixNormals(root){ root.traverse(o => { const n = o.geometry && o.geometry.attributes && o.geometry.attributes.normal; if (!n || n.userData?.fixed) return; const a = n.array;
  for (let i = 0; i < a.length; i += 3){ const l = Math.hypot(a[i], a[i + 1], a[i + 2]); if (!(l > 1e-6)){ a[i] = 0; a[i + 1] = 1; a[i + 2] = 0; } } n.needsUpdate = true; n.userData = { fixed: true }; }); }
fixNormals(scene);
updateEnv();
renderer.shadowMap.needsUpdate = true;
const VIEWS = {
  overview: () => { camera.position.copy(HOME.pos); controls.target.copy(HOME.target); },
  court: () => { camera.position.set(46, 40, 150); controls.target.set(0, 6, 80); },
  sanctum: () => { camera.position.set(34, 44, 52); controls.target.set(0, 30, -14); },
  bridges: () => { camera.position.set(150, 46, 60); controls.target.set(80, 6, -20); },
  skyline: () => { camera.position.set(-60, 70, -10); controls.target.set(0, 30, -95); },
  library: () => { props.door.open = 1; props.door.t = 1; camera.position.set(0, 19.5, -5.5); controls.target.set(0, 18.4, -17.5); },
  booth: () => { camera.position.set(BOOTH.x + 9, BOOTH.top + 7, BOOTH.z + 17); controls.target.set(BOOTH.x, BOOTH.top + 4.5, BOOTH.z); },
  garden: () => { const [p, t] = SPOTS.garden(); camera.position.copy(p); controls.target.copy(t); },
  plaza: () => { camera.position.set(18, 24, 128); controls.target.set(0, 10, 84); },
  statue: () => { camera.position.set(4, 10, 100); controls.target.set(0, 8.5, 84); },
  gate: () => { camera.position.set(0, 24, 66); controls.target.set(0, 20, 0); },
  sites: () => { camera.position.set(0, 26, 168); controls.target.set(0, 2, 124); },
};
window.__walk = { terrainH, pads, obstacles, blockedAt, fp, updateFP, groundAt, enterFP, exitFP, setPreset, camera, enterSwing, exitSwing, openBooth, interact, props, interactives, pickHit, get mode(){ return mode; }, flashNow(){ ltT = 0; ltDir.set(0.3, 1, 0.2).normalize(); } };
window.__viewer = {
  spot(key, arg){ exitFP(); const [p, t] = SPOTS[key](arg); camera.position.copy(p); controls.target.copy(t); if (insideLib(p)){ props.door.open = 1; props.door.t = 1; } tween = null; controls.update(); return true; },
  fly: (k, after) => flyTo(k, after), pets: petList,
  cam(a){ exitFP(); camera.position.set(a[0], a[1], a[2]); controls.target.set(a[3], a[4], a[5]); tween = null; controls.update(); return true; },
  petCam(i){ const h = petList[i].g.position, sd = Math.sign(h.x) || 1; return this.cam([h.x - sd * 3.2, h.y + 4.2, h.z + 7.2, h.x, h.y + 1.2, h.z]); },
  talk(k){ if (k === 'statue') openTalk(STATUE_TALK); else if (k === 'book') openBook(); else openBooth(); return true; },
  greet(i){ greetPet(petList[i]); return true; },
  river(m){ riverMode = m; riverU.uPink.value = m === 1 ? 1 : 0; riverU.uAur.value = m === 2 ? 1 : 0; return true; },
  shell(i, show = true){ const sh = shellList[i]; sh.open = 1; sh.t = 1; if (show) showCard(sh); return true; },
  book(s, steps = 120){ const b = props.book.book; b.openTo(s); for (let i = 0; i < steps; i++) b.update(0.05, i * 0.05); return true; },
  boatCat(i){ greetBoatCat(boatCats[i]); return true; },
  songState(){ return { on: song.on, t: song.el ? song.el.currentTime : -1, level: +song.level.toFixed(3), bubbles: [...document.querySelectorAll('.bubble')].map(e => e.textContent) }; },
  views: ['overview', 'overview-dusk', 'overview-night', 'overview-storm', 'court', 'sanctum', 'bridges', 'skyline', 'library', 'booth', 'garden', 'plaza', 'statue', 'gate', 'sites', 'walk'],
  setView(name){
    const [v, t] = name.split('-');
    if (v === 'walk'){ enterFP(); return true; }
    if (v === 'swing'){ enterSwing(); return true; }
    exitFP(); if (!VIEWS[v]) return false; VIEWS[v](); controls.update(); setPreset(t || 'morning', true); tween = null; return true;
  }
};
{ const q = new URLSearchParams(location.search); if (q.get('t') && PRESETS[q.get('t')]) setPreset(q.get('t'), true); if (q.get('v')) window.__viewer.setView(q.get('v')); }
if (new URLSearchParams(location.search).has('qa')) window.__audit = { scene, renderer, AC, BOOTH, SWING, terrainH, chanFloor, get musicSrc(){return musicSrc;}, musicGain, get bgmBuf(){return bgmBuf;}, get loopEnd(){return bgmLoopEnd;} };
await tick(93, '正在点亮水母与灯火……');
{
  // Materials render into the composer's offscreen target, whose shader variant differs from the canvas one.
  // Compile exactly that variant (plus hidden storm objects) so the first frame doesn't recompile everything.
  const hidden = []; scene.traverse(o => { if (!o.visible && (o.isMesh || o.isPoints)) { hidden.push(o); o.visible = true; } });
  const prevRT = renderer.getRenderTarget();
  let p = 93; const creep = setInterval(() => { p = Math.min(98, p + (98 - p) * 0.08); setLoad(p, '正在点亮水母与灯火……'); }, 120);
  try {
    renderer.setRenderTarget(composer.readBuffer);
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera);
  } catch (e) {}
  renderer.setRenderTarget(prevRT);
  for (const o of hidden) o.visible = false;
  clearInterval(creep);
  // finish linking program by program, yielding between each so the bar reports real progress
  const progs = renderer.info.programs.slice();
  for (let i = 0; i < progs.length; i++){
    try { progs[i].getUniforms(); } catch (e) {}
    if (i % 3 === 2) await tick(p + (99 - p) * (i + 1) / progs.length, '正在点亮水母与灯火……');
  }
}
requestAnimationFrame(frame);
await new Promise(r => { const w = () => (window.__sceneReady ? setTimeout(r, 120) : requestAnimationFrame(w)); w(); });
setLoad(100, '圣城已经苏醒');
const enter = () => { if (window.__entered) return; loaderEl.classList.add('hide'); window.__entered = true; musicOn = true; startMusic(); syncMusic(); setTimeout(() => loaderEl.remove(), 1000); };
window.__enter = enter;
setTimeout(enter, 350);
loadBgm();
